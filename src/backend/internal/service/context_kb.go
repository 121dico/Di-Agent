package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/agent-hub/backend/internal/port"
)

// KBBuilder 构建知识库引用上下文段，前置到 current。
// 优先使用预加载内容（in.KBPreload）；为空时回退到实时解析 in.Content 中的 {{user/KB}} 引用。
// 无引用或解析失败时返回 current 不变。
type KBBuilder struct {
	KBResolver  OrchKBResolver
	TokenIssuer port.TokenIssuerPort
	ServerURL   string
}

// Build 实现 ContextBuilder。
func (b *KBBuilder) Build(ctx context.Context, in ContextInput, current string) string {
	text := b.buildKBText(ctx, in)
	if text == "" {
		return current
	}
	return text + current
}

// buildKBText 优先使用预加载的 KBPreload，否则实时解析 in.Content。
func (b *KBBuilder) buildKBText(ctx context.Context, in ContextInput) string {
	if strings.TrimSpace(in.KBPreload) != "" {
		return in.KBPreload
	}
	return b.resolveKB(ctx, in.Content, in.UserID)
}

// resolveKB 实时解析 content 中的知识库引用，返回完整 KB 上下文段。
// RouteMention 入口和 chain 内 KBBuilder 共享此实现。
func (b *KBBuilder) resolveKB(ctx context.Context, content, userID string) string {
	if b.KBResolver == nil {
		return ""
	}
	refs := ParseKnowledgeRefs(content)
	if len(refs) == 0 {
		return ""
	}
	var kbSection strings.Builder
	needTool := false
	query := content
	for _, ref := range refs {
		query = strings.ReplaceAll(query, ref.Raw, " ")
	}
	query = strings.TrimSpace(query)
	for _, ref := range refs {
		kb, files, err := b.KBResolver.ResolveKnowledgeRef(ctx, userID, ref.Username, ref.KBName)
		if err != nil {
			slog.Warn("resolve knowledge ref failed", "ref", ref.Raw, "error", err)
			continue
		}
		kbSection.WriteString(fmt.Sprintf("[知识库: %s/%s (%s)]\n", ref.Username, ref.KBName, kb.Visibility))
		if retriever, ok := b.KBResolver.(OrchKBRAGRetriever); ok {
			results, searchErr := retriever.SearchRAG(ctx, userID, kb.ID, query, 0)
			if searchErr != nil {
				slog.Warn("rag knowledge retrieval failed; using file fallback", "kb_id", kb.ID, "error", searchErr)
			} else if len(results) > 0 {
				kbSection.WriteString("以下为与当前问题最相关的知识片段：\n")
				for _, result := range results {
					kbSection.WriteString(fmt.Sprintf("- [来源: %s, file_id=%s, chunk=%d, score=%.4f, mode=%s]\n%s\n",
						result.Filename, result.FileID, result.ChunkIndex, result.Score, result.RetrievalMode, result.Content))
				}
				kbSection.WriteString("\n")
				continue
			}
		}
		if len(files) == 0 {
			kbSection.WriteString("（空知识库，无文件）\n")
		} else {
			for _, f := range files {
				switch f.PreviewType {
				case "text":
					text := f.PreviewText
					if len([]rune(text)) > kbMaxInlineChars {
						text = truncateString(text, kbMaxInlineChars) + "\n...[内容已截断，使用 read_knowledge_file 工具读取完整内容]"
						needTool = true
					}
					kbSection.WriteString(fmt.Sprintf("- %s (file_id=%s, %s):\n```\n%s\n```\n", f.Filename, f.ID, formatFileSize(f.FileSize), text))
				case "image":
					kbSection.WriteString(fmt.Sprintf("- %s (file_id=%s, %s, %s, 使用 read_knowledge_file 工具获取)\n", f.Filename, f.ID, formatFileSize(f.FileSize), f.PreviewText))
					needTool = true
				case "too_large":
					kbSection.WriteString(fmt.Sprintf("- %s (file_id=%s, %s, 文件过大，使用 read_knowledge_file 工具读取)\n", f.Filename, f.ID, formatFileSize(f.FileSize)))
					needTool = true
				default:
					kbSection.WriteString(fmt.Sprintf("- %s (file_id=%s, %s, 使用 read_knowledge_file 工具读取)\n", f.Filename, f.ID, formatFileSize(f.FileSize)))
					needTool = true
				}
			}
		}
		kbSection.WriteString("\n")
	}
	if kbSection.Len() == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("[引用的知识库]\n")
	sb.WriteString(kbSection.String())
	if needTool && b.TokenIssuer != nil && b.ServerURL != "" {
		token, _, err := b.TokenIssuer.IssueAgentToken(userID)
		if err != nil {
			slog.Warn("generate kb tool token failed", "error", err)
		} else {
			sb.WriteString(GenerateKBReadTool(b.ServerURL, token))
			sb.WriteString("\n")
		}
	}
	return sb.String()
}
