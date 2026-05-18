<script lang="ts">
	import { arweaveUrl } from '$lib/services/arweave';

	interface Props {
		uri: string;
		label?: string;
	}

	let { uri, label }: Props = $props();
</script>

<a
	href={arweaveUrl(uri)}
	target="_blank"
	rel="noopener noreferrer"
	class="font-mono text-primary hover:underline"
>{label ?? uri}</a>
