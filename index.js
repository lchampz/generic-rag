const fs = require("fs/promises");
const path = require("path");
const { cwd } = require("process");
const readline = require("readline");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "all-minilm";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.2";

const DEFAULT_TOP_K = Number(process.env.TOP_K || 4);
const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 6000);
const DOCS_DIR = path.join(cwd(), "docs");

async function listMarkdownFiles() {
  const files = [];

  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  await scanDir(DOCS_DIR);
  return files;
}

function chunkMarkdown(content, filePath) {
	const lines = content.split(/\r?\n/);
	const chunks = [];
	let buffer = [];
	let startLine = 1;

	const flush = (endLine) => {
		if (buffer.length === 0) return;
		const text = buffer.join("\n").trim();
		if (text.length > 0) {
			chunks.push({
				filePath,
				text,
				startLine,
				endLine,
			});
		}
		buffer = [];
	};

	lines.forEach((line, idx) => {
		const lineNumber = idx + 1;
		if (line.trim() === "") {
			flush(lineNumber - 1);
			startLine = lineNumber + 1;
			return;
		}
		buffer.push(line);
	});

	flush(lines.length);
	return chunks;
}

async function ollamaEmbedding(text) {
	const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Falha ao gerar embedding: ${response.status} ${body}`);
	}

	const data = await response.json();
	return data.embedding;
}

function cosineSimilarity(a, b) {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i += 1) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildIndex(mdFiles) {
	const documents = [];

	for (const filePath of mdFiles) {
		const content = await fs.readFile(filePath, "utf8");
		const chunks = chunkMarkdown(content, filePath);
		for (const chunk of chunks) {
			const embedding = await ollamaEmbedding(chunk.text);
			documents.push({ ...chunk, embedding });
		}
	}

	return documents;
}

function buildContext(topChunks) {
	let context = "";
	for (const chunk of topChunks) {
		const header = `Fonte: ${path.basename(chunk.filePath)} (linhas ${chunk.startLine}-${chunk.endLine})`;
		const block = `${header}\n${chunk.text}\n`;
		if (context.length + block.length > MAX_CONTEXT_CHARS) break;
		context += block + "\n";
	}
	return context.trim();
}

async function askOllama(question, context) {
	const system = `Você responde SOMENTE com base no contexto fornecido. Se a resposta não estiver no contexto, diga "Não encontrei essa informação nos arquivos.". Sempre cite as fontes informando o arquivo e o intervalo de linhas.`;
	const prompt = `Contexto:\n${context}\n\nPergunta: ${question}\nResposta:`;

	const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: CHAT_MODEL,
			prompt: `${system}\n\n${prompt}`,
			stream: false,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Falha ao gerar resposta: ${response.status} ${body}`);
	}

	const data = await response.json();
	return data.response.trim();
}

async function query(question, documents) {
  const questionEmbedding = await ollamaEmbedding(question);

  const ranked = documents
    .map((doc) => ({
      ...doc,
      score: cosineSimilarity(questionEmbedding, doc.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, DEFAULT_TOP_K);

  const context = buildContext(ranked);
  if (!context) {
    return "Não encontrei essa informação nos arquivos.";
  }

  return askOllama(question, context);
}

async function main() {
  console.log("🔍 RAG - Carregando documentos da pasta docs/...\n");

  const mdFiles = await listMarkdownFiles();
  if (mdFiles.length === 0) {
    console.log("Nenhum arquivo .md encontrado na pasta docs/");
    process.exit(1);
  }

  console.log(`📄 ${mdFiles.length} arquivo(s) encontrado(s):`);
  mdFiles.forEach((f) => console.log(`   - ${path.relative(__dirname, f)}`));
  console.log("\n⏳ Gerando embeddings...");

  const documents = await buildIndex(mdFiles);

  console.log("✅ Índice pronto!\n");
  console.log('Digite sua pergunta (ou "sair" para encerrar):\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("❓ ", async (input) => {
      const question = input.trim();
      if (!question || question.toLowerCase() === "sair") {
        console.log("Até mais! 👋");
        rl.close();
        return;
      }

      const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let i = 0;
      const loading = setInterval(() => {
        process.stdout.write(`\r${spinner[i++ % spinner.length]} Pensando...`);
      }, 80);

      try {
        const answer = await query(question, documents);
        clearInterval(loading);
        process.stdout.write("\r" + " ".repeat(20) + "\r");
        console.log(`💬 ${answer}\n`);
      } catch (err) {
        clearInterval(loading);
        process.stdout.write("\r" + " ".repeat(20) + "\r");
        console.error(`Erro: ${err.message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
