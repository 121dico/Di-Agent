package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// 失败继续使用原消息：刷新读取与实时终态事件都来自同一份持久化结果。
func prepareStreamingFailure(ctx context.Context, deps StreamingPipelineDeps, handle *StreamingHandle, opts *FinalizeStreamingPipelineOptions) error {
	previous, err := deps.MsgRepo.GetByID(ctx, handle.MessageID)
	if err != nil {
		return fmt.Errorf("read failing message: %w", err)
	}
	var blocks []model.MessageBlock
	previousContent := ""
	if previous != nil {
		previousCopy := *previous
		opts.previousMessage = &previousCopy
		previousContent = previous.Content
		if previous.Status == model.MessageStatusCanceled {
			opts.Status = model.MessageStatusCanceled
		}
		if opts.Content == "" {
			opts.Content = previous.Content
		}
		if previous.BlocksJSON != "" {
			if err := json.Unmarshal([]byte(previous.BlocksJSON), &blocks); err != nil {
				return fmt.Errorf("read failing message blocks: %w", err)
			}
		}
	}
	if snapshot, ok := deps.StreamingBuffer.(interface {
		GetState(string) (StreamingState, bool)
	}); ok {
		if state, found := snapshot.GetState(handle.TaskID); found {
			if state.Status == model.MessageStatusCanceled {
				opts.Status = model.MessageStatusCanceled
			}
			if len(state.Blocks) > 0 {
				blocks = mergeFailureBlocks(blocks, state.Blocks)
			}
		}
	}
	// 旧消息可能只有 content，新结果可能比最后一次增量更完整；均不能丢失。
	for _, content := range []string{previousContent, opts.Content} {
		text := failureBlockText(blocks)
		if content == "" || strings.Contains(text, content) {
			continue
		}
		if strings.HasPrefix(content, text) {
			content = strings.TrimPrefix(content, text)
		}
		blocks = append(blocks, model.MessageBlock{Kind: model.BlockKindText, Text: content})
	}
	opts.Content = failureBlockText(blocks)
	if opts.Status == model.MessageStatusError {
		reason := safeAgentFailureReason(opts.ErrorReason)
		hasReason := false
		for i := range blocks {
			if blocks[i].Kind == model.BlockKindError {
				blocks[i].Text = safeAgentFailureReason(blocks[i].Text)
				if reason == "" {
					reason = blocks[i].Text
				}
				if blocks[i].Text == reason {
					hasReason = true
				}
			}
		}
		if reason == "" {
			reason = "本次执行未完成，未保存具体失败原因。"
		}
		if !hasReason {
			blocks = append(blocks, model.MessageBlock{Index: len(blocks), Kind: model.BlockKindError, Text: reason, IsError: true})
		}
	}
	for i := range blocks {
		blocks[i].Index = i
	}
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return fmt.Errorf("encode failing message blocks: %w", err)
	}
	opts.BlocksJSON = string(encoded)
	return nil
}

// 缓冲区通常是完整快照，按相同 index/kind 合并；截短或不相容的正文不覆盖旧正文。
func mergeFailureBlocks(previous, buffered []model.MessageBlock) []model.MessageBlock {
	merged := append([]model.MessageBlock(nil), previous...)
	for _, next := range buffered {
		matched := false
		for i, old := range merged {
			if old.Index != next.Index || old.Kind != next.Kind {
				continue
			}
			if old.Text == next.Text || strings.HasPrefix(next.Text, old.Text) {
				merged[i] = next
				matched = true
			} else if strings.HasPrefix(old.Text, next.Text) {
				matched = true
			}
			if matched {
				break
			}
		}
		if !matched {
			merged = append(merged, next)
		}
	}
	return merged
}

func failureBlockText(blocks []model.MessageBlock) string {
	var text strings.Builder
	for _, block := range blocks {
		if block.Kind == model.BlockKindText {
			text.WriteString(block.Text)
		}
	}
	return text.String()
}

// 上游错误可能包含请求头和连接串；聊天持久化/WS 边界只允许脱敏且限长的诊断。
func safeAgentFailureReason(reason string) string {
	// 必须先脱敏再截断，避免留下被截断的半个凭据。
	for _, pattern := range []string{
		`(?is)-----BEGIN[^\n]*PRIVATE KEY-----.*?(?:-----END[^\n]*PRIVATE KEY-----|$)`,
		`(?i)\b(?:authorization|proxy-authorization|cookie|set-cookie)\b["']?\s*[:=]\s*[^\r\n]*`,
		`(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+`,
		`(?i)(?:https?|jdbc:[a-z0-9]+)://[^\s<>"']+`,
		`(?i)\b(?:[a-z0-9_]*api[_-]?key|[a-z0-9_]*token|password|passwd|pwd|client[_-]?secret|secret|credential)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)`,
		`\bsk[-_][A-Za-z0-9_-]+`,
		`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
	} {
		reason = regexp.MustCompile(pattern).ReplaceAllString(reason, "[已隐藏敏感信息]")
	}
	reason = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, reason)
	return truncateString(strings.TrimSpace(reason), 2000)
}
