export function encodeJsonRpcMessage(message) {
	return `${JSON.stringify(message)}\n`;
}

export class JsonRpcMessageParser {
	constructor() {
		this.buffer = Buffer.alloc(0);
	}

	push(chunk) {
		this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
		const messages = [];

		while (this.buffer.length > 0) {
			const framed = this.#tryReadFramed();
			if (framed.waiting) break;
			if (framed.message) {
				messages.push(framed.message);
				continue;
			}

			const line = this.#tryReadLine();
			if (line.waiting) break;
			if (line.message) {
				messages.push(line.message);
				continue;
			}

			break;
		}

		return messages;
	}

	#tryReadFramed() {
		const headerEnd = this.buffer.indexOf('\r\n\r\n');
		if (headerEnd < 0) {
			if (this.buffer.includes(Buffer.from('Content-Length:', 'utf8'))) {
				return { waiting: true };
			}
			return { waiting: false };
		}

		const header = this.buffer.slice(0, headerEnd).toString('utf8');
		const match = /content-length:\s*(\d+)/i.exec(header);
		if (!match) return { waiting: false };
		const length = Number(match[1]);
		const bodyStart = headerEnd + 4;
		const bodyEnd = bodyStart + length;
		if (this.buffer.length < bodyEnd) return { waiting: true };
		const message = JSON.parse(this.buffer.slice(bodyStart, bodyEnd).toString('utf8'));
		this.buffer = this.buffer.slice(bodyEnd);
		return { message };
	}

	#tryReadLine() {
		const newline = this.buffer.indexOf('\n');
		if (newline < 0) return { waiting: true };
		const line = this.buffer.slice(0, newline).toString('utf8').trim();
		this.buffer = this.buffer.slice(newline + 1);
		if (!line) return {};
		return { message: JSON.parse(line) };
	}
}
