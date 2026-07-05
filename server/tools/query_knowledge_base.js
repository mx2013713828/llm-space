const queryKnowledgeBase = {
	name: 'query_knowledge_base',
	description: 'Search mounted knowledge bases for relevant chunks. Use this for questions that may depend on project documents, uploaded files, or mounted knowledge base content.',
	parameters: {
		query: {
			type: 'string',
			description: 'The natural-language search query.',
			required: true,
		},
		knowledgeBaseIds: {
			type: 'array',
			description: 'Optional mounted knowledge base ids to search. If omitted, all mounted knowledge bases are searched.',
			required: false,
		},
		topK: {
			type: 'number',
			description: 'Optional maximum number of chunks to return.',
			required: false,
		},
		maxChars: {
			type: 'number',
			description: 'Optional maximum total characters to return.',
			required: false,
		},
		scoreThreshold: {
			type: 'number',
			description: 'Optional minimum retrieval score.',
			required: false,
		},
	},
	async execute() {
		return '[query_knowledge_base is handled by KnowledgePlugin at runtime]';
	},
};

export default queryKnowledgeBase;
