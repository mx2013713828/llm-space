const listMountedKnowledgeBases = {
	name: 'list_mounted_knowledge_bases',
	description: 'List the knowledge bases currently mounted to this harness, including their ids, names, descriptions, file counts, and chunk counts. Use this when the user asks what knowledge bases are available.',
	parameters: {},
	async execute() {
		return '[list_mounted_knowledge_bases is handled by KnowledgePlugin at runtime]';
	},
};

export default listMountedKnowledgeBases;
