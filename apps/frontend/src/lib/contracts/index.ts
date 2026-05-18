import DAATokenABI from './DAAToken.abi.json';
import DAARegistryABI from './DAARegistry.abi.json';
import ContractRegistryABI from './ContractRegistry.abi.json';
import PubkeyRegistryABI from './PubkeyRegistry.abi.json';

export const daaTokenAddress = import.meta.env.VITE_DAA_TOKEN_ADDRESS as `0x${string}`;
export const daaRegistryAddress = import.meta.env.VITE_DAA_REGISTRY_ADDRESS as `0x${string}`;
export const contractRegistryAddress = import.meta.env.VITE_CONTRACT_REGISTRY_ADDRESS as `0x${string}`;
export const pubkeyRegistryAddress = import.meta.env.VITE_PUBKEY_REGISTRY_ADDRESS as `0x${string}`;
export const safeAddress = import.meta.env.VITE_SAFE_ADDRESS as `0x${string}`;
export const sxSpaceAddress = import.meta.env.VITE_SX_SPACE_ADDRESS as `0x${string}`;
export const normalStrategyAddress = import.meta.env.VITE_NORMAL_STRATEGY_ADDRESS as `0x${string}`;
export const coreStrategyAddress = import.meta.env.VITE_CORE_STRATEGY_ADDRESS as `0x${string}`;
export const authenticatorAddress = import.meta.env.VITE_AUTHENTICATOR_ADDRESS as `0x${string}`;

export const termsCategoryId = import.meta.env.VITE_TERMS_CATEGORY_ID
	? Number(import.meta.env.VITE_TERMS_CATEGORY_ID)
	: null;
export const termsDocumentId = import.meta.env.VITE_TERMS_DOCUMENT_ID
	? Number(import.meta.env.VITE_TERMS_DOCUMENT_ID)
	: null;

export const daaTokenConfig = {
	address: daaTokenAddress,
	abi: DAATokenABI
} as const;

export const daaRegistryConfig = {
	address: daaRegistryAddress,
	abi: DAARegistryABI
} as const;

export const contractRegistryConfig = {
	address: contractRegistryAddress,
	abi: ContractRegistryABI
} as const;

export const pubkeyRegistryConfig = {
	address: pubkeyRegistryAddress,
	abi: PubkeyRegistryABI
} as const;

export const contractTemplateCategoryId = import.meta.env.VITE_CONTRACT_TEMPLATE_CATEGORY_ID
	? Number(import.meta.env.VITE_CONTRACT_TEMPLATE_CATEGORY_ID)
	: null;

export { DAATokenABI, DAARegistryABI, ContractRegistryABI, PubkeyRegistryABI };
