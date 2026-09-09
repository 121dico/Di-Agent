# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Layered architecture: domain / port / service / infrastructure | Filled |
| [Database Guidelines](./database-guidelines.md) | pgx, migrations, partial unique index pattern | Filled |
| [Error Handling](./error-handling.md) | Sentinel errors, HTTP code matrix, unique violation pattern | Filled |
| [Event Broadcaster](./event-broadcaster.md) | Domain events → online WS clients (e.g. `conversation.role_changed`) | Filled |
| [Context Builder Chain](./context-builder.md) | Chain-of-responsibility pipeline for LLM context assembly (5 chains) | Filled |
| [Knowledge RAG](./knowledge-rag.md) | pgvector schema, Ollama embedding, chunking, retrieval, fallback, and reindex contracts | Filled |
| [Conversation Context](./conversation-context.md) | Checkpoint lifecycle, Session rollover, token meter, daemon and REST contracts | Filled |
| [Dispatcher Module](./dispatcher.md) | Router / Dispatcher / AgentQueue split of dispatch responsibilities | Filled |
| [Agent Runtime and Skill Install](./agent-runtime-and-skill-install.md) | Runtime metrics, local Skill catalog/loading, execution-trace replay, and GitHub Skill deployment | Filled |
| [Fixed Data Reporting](./data-reporting.md) | Governed data sources, report definitions, snapshots, scheduling, and downloads | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Context 传递、错误处理、依赖管理、接口设计 | Filled |
| [Native Chat Images](./chat-image-input.md) | Clipboard/drop uploads and native Codex/Claude image delivery | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
