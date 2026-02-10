# 🔍 Generic RAG

RAG (Retrieval-Augmented Generation) genérico que lê arquivos Markdown e responde perguntas baseado **exclusivamente** no conteúdo dos documentos, citando as fontes.

## Pré-requisitos

- Node.js 18+
- [Ollama](https://ollama.ai) rodando localmente

## Instalação

1. Clone o repositório e entre na pasta:

```bash
cd generic-rag
```

2. Baixe os modelos necessários no Ollama:

```bash
ollama pull all-minilm      # modelo de embeddings
ollama pull llama3.2        # modelo de chat
```

## Uso

1. Coloque seus arquivos `.md` na pasta `docs/`

2. Execute:

```bash
node index.js
```

3. Digite suas perguntas no terminal. Digite `sair` para encerrar.

## Configuração (opcional)

Você pode customizar via variáveis de ambiente:

| Variável             | Padrão                   | Descrição                        |
| -------------------- | ------------------------ | -------------------------------- |
| `OLLAMA_BASE_URL`    | `http://localhost:11434` | URL do Ollama                    |
| `OLLAMA_EMBED_MODEL` | `all-minilm`             | Modelo de embeddings             |
| `OLLAMA_CHAT_MODEL`  | `llama3.2`               | Modelo de chat                   |
| `TOP_K`              | `4`                      | Quantidade de trechos relevantes |
| `MAX_CONTEXT_CHARS`  | `6000`                   | Limite de caracteres no contexto |

Exemplo:

```bash
OLLAMA_CHAT_MODEL=mistral node index.js
```

## Estrutura

```
generic-rag/
├── index.js      # código principal
├── docs/         # seus arquivos .md aqui
│   └── *.md
└── README.md
```

## Como funciona

1. Lê todos os `.md` da pasta `docs/`
2. Divide em chunks por parágrafos
3. Gera embeddings de cada chunk via Ollama
4. Ao receber uma pergunta, busca os trechos mais similares
5. Envia o contexto + pergunta para o LLM
6. Retorna a resposta com citação das fontes
