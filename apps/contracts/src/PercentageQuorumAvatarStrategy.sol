// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IAvatar } from "@zodiac/interfaces/IAvatar.sol";
// IExecutionStrategy declares two errors used below — `InvalidProposalStatus(ProposalStatus)`
// and `ExecutionFailed()` — neither is redeclared locally. If sx-evm's interface signatures
// change in a future version, those revert paths bind to the new definitions silently.
// Pinned expectation: sx-evm @ commit baseline used at Stage 19 deploy. If the lockfile
// version diverges, re-verify the two error selectors before deploying.
import { IExecutionStrategy } from "sx-evm/interfaces/IExecutionStrategy.sol";
import { MetaTransaction, Proposal, ProposalStatus, FinalizationStatus } from "sx-evm/types.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC721Supply {
    function totalSupply() external view returns (uint256);
}

/// @title Percentage Quorum Avatar Execution Strategy
/// @notice Executes proposal transactions through a Gnosis Safe (Avatar) when
///         both participation quorum and approval threshold are met.
///         Drop-in replacement for sx-evm's AvatarExecutionStrategy with dynamic quorum.
contract PercentageQuorumAvatarStrategy is IExecutionStrategy, Ownable, ReentrancyGuard {
    // ──────────────────────── Events ──────────────────────────

    event VotingTokenSet(address indexed token);
    event ApprovalThresholdUpdated(uint256 newPercentage);
    event ParticipationQuorumUpdated(uint256 newPercentage);
    event TargetSet(address indexed newTarget);
    event SpaceEnabled(address space);
    event SpaceDisabled(address space);
    event Sealed();

    // ──────────────────────── Errors ──────────────────────────

    error InvalidPercentage();
    error InvalidSpace();
    error ZeroAddress();
    error NoMembers();
    error ContractSealed();

    // ──────────────────────── State ───────────────────────────

    /// @notice The Gnosis Safe that this strategy executes transactions through.
    address public target;

    /// @notice The voting token whose totalSupply determines the denominator.
    address public votingToken;

    /// @notice Minimum percentage of For votes relative to totalSupply (1–100).
    ///         A proposal needs votesFor >= ceil(totalSupply * approvalThreshold / 100).
    uint256 public approvalThreshold;

    /// @notice Minimum percentage of total participation relative to totalSupply (0–100).
    ///         When 0, no participation check is enforced.
    ///         When > 0, a proposal needs (votesFor + votesAgainst + votesAbstain) >= ceil(totalSupply * participationQuorum / 100).
    uint256 public participationQuorum;

    /// @notice Whitelisted Snapshot X spaces that can call execute().
    mapping(address => bool) public spaces;

    /// @notice Whether the contract has been isSealed (admin functions permanently disabled).
    bool public isSealed;

    // ──────────────────────── Modifiers ──────────────────────

    modifier onlySpace() {
        if (!spaces[msg.sender]) revert InvalidSpace();
        _;
    }

    // ──────────────────────── Constructor ─────────────────────

    constructor(
        address _owner,
        address _target,
        address[] memory _spaces,
        address _votingToken,
        uint256 _approvalThreshold,
        uint256 _participationQuorum
    ) Ownable(_owner) {
        if (_target == address(0)) revert ZeroAddress();
        if (_votingToken == address(0)) revert ZeroAddress();
        target = _target;
        votingToken = _votingToken;
        _setApprovalThreshold(_approvalThreshold);
        _setParticipationQuorum(_participationQuorum);
        for (uint256 i = 0; i < _spaces.length; i++) {
            spaces[_spaces[i]] = true;
            emit SpaceEnabled(_spaces[i]);
        }
    }

    // ──────────────────────── IExecutionStrategy ─────────────

    /// @notice Executes a proposal if both quorum and approval threshold are met.
    function execute(
        uint256 /* proposalId */,
        Proposal memory proposal,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 votesAbstain,
        bytes memory payload
    ) external override onlySpace nonReentrant {
        ProposalStatus status = getProposalStatus(proposal, votesFor, votesAgainst, votesAbstain);
        if (status != ProposalStatus.Accepted && status != ProposalStatus.VotingPeriodAccepted) {
            revert InvalidProposalStatus(status);
        }

        MetaTransaction[] memory transactions = abi.decode(payload, (MetaTransaction[]));
        for (uint256 i = 0; i < transactions.length; i++) {
            bool success = IAvatar(target).execTransactionFromModule(
                transactions[i].to,
                transactions[i].value,
                transactions[i].data,
                transactions[i].operation
            );
            if (!success) revert ExecutionFailed();
        }
    }

    /// @notice Returns the proposal status based on participation quorum and approval threshold.
    function getProposalStatus(
        Proposal memory proposal,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 votesAbstain
    ) public view override returns (ProposalStatus) {
        uint256 supply = IERC721Supply(votingToken).totalSupply();
        if (supply == 0) revert NoMembers();

        // Approval: votesFor must meet the approval threshold
        uint256 approvalNeeded = (supply * approvalThreshold + 99) / 100;
        bool approvalMet = votesFor >= approvalNeeded && votesFor > votesAgainst;

        // Participation: total votes must meet the participation quorum (if set)
        bool quorumMet = true;
        if (participationQuorum > 0) {
            uint256 quorumNeeded = (supply * participationQuorum + 99) / 100;
            uint256 totalVotes = votesFor + votesAgainst + votesAbstain;
            quorumMet = totalVotes >= quorumNeeded;
        }

        bool accepted = approvalMet && quorumMet;

        if (proposal.finalizationStatus == FinalizationStatus.Cancelled) {
            return ProposalStatus.Cancelled;
        } else if (proposal.finalizationStatus == FinalizationStatus.Executed) {
            return ProposalStatus.Executed;
        } else if (block.number < proposal.startBlockNumber) {
            return ProposalStatus.VotingDelay;
        } else if (block.number < proposal.minEndBlockNumber) {
            return ProposalStatus.VotingPeriod;
        } else if (block.number < proposal.maxEndBlockNumber) {
            if (accepted) {
                return ProposalStatus.VotingPeriodAccepted;
            } else {
                return ProposalStatus.VotingPeriod;
            }
        } else if (accepted) {
            return ProposalStatus.Accepted;
        } else {
            return ProposalStatus.Rejected;
        }
    }

    function getStrategyType() external pure override returns (string memory) {
        return "PercentageQuorumAvatar";
    }

    // ──────────────────────── Views ──────────────────────────

    /// @notice Returns the number of For votes needed to meet the approval threshold.
    function effectiveApprovalThreshold() public view returns (uint256) {
        uint256 supply = IERC721Supply(votingToken).totalSupply();
        if (supply == 0) revert NoMembers();
        return (supply * approvalThreshold + 99) / 100;
    }

    /// @notice Returns the number of total votes needed to meet participation quorum.
    ///         Returns 0 if participation quorum is disabled.
    function effectiveParticipationQuorum() public view returns (uint256) {
        if (participationQuorum == 0) return 0;
        uint256 supply = IERC721Supply(votingToken).totalSupply();
        if (supply == 0) revert NoMembers();
        return (supply * participationQuorum + 99) / 100;
    }

    // ──────────────────────── Admin ──────────────────────────

    /// @notice Permanently lock all admin functions. Cannot be undone.
    function seal() external onlyOwner {
        isSealed = true;
        emit Sealed();
    }

    function setApprovalThreshold(uint256 _approvalThreshold) external onlyOwner {
        if (isSealed) revert ContractSealed();
        _setApprovalThreshold(_approvalThreshold);
    }

    function setParticipationQuorum(uint256 _participationQuorum) external onlyOwner {
        if (isSealed) revert ContractSealed();
        _setParticipationQuorum(_participationQuorum);
    }

    function setVotingToken(address _votingToken) external onlyOwner {
        if (isSealed) revert ContractSealed();
        if (_votingToken == address(0)) revert ZeroAddress();
        votingToken = _votingToken;
        emit VotingTokenSet(_votingToken);
    }

    function setTarget(address _target) external onlyOwner {
        if (isSealed) revert ContractSealed();
        if (_target == address(0)) revert ZeroAddress();
        target = _target;
        emit TargetSet(_target);
    }

    function enableSpace(address space) external onlyOwner {
        if (isSealed) revert ContractSealed();
        spaces[space] = true;
        emit SpaceEnabled(space);
    }

    function disableSpace(address space) external onlyOwner {
        if (isSealed) revert ContractSealed();
        spaces[space] = false;
        emit SpaceDisabled(space);
    }

    // ──────────────────────── Internal ────────────────────────

    function _setApprovalThreshold(uint256 _approvalThreshold) internal {
        if (_approvalThreshold == 0 || _approvalThreshold > 100) {
            revert InvalidPercentage();
        }
        approvalThreshold = _approvalThreshold;
        emit ApprovalThresholdUpdated(_approvalThreshold);
    }

    function _setParticipationQuorum(uint256 _participationQuorum) internal {
        if (_participationQuorum > 100) {
            revert InvalidPercentage();
        }
        participationQuorum = _participationQuorum;
        emit ParticipationQuorumUpdated(_participationQuorum);
    }
}
