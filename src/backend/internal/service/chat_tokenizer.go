package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type ChatTextTokenizer interface {
	Count(context.Context, string, []string) ([]int64, string, error)
}

// Python调用固定官方词表，仅经stdin处理公开文本；超时/未知模型回退为明确估算。
type OfficialChatTokenizer struct {
	Python, Script string
	mu             sync.Mutex
	cache          map[[32]byte][]int64
	gate           chan struct{}
}

func (t *OfficialChatTokenizer) Count(ctx context.Context, model string, texts []string) ([]int64, string, error) {
	model = strings.TrimSuffix(model, "[1m]")
	if model != "deepseek-v4-pro" && model != "deepseek-v4-flash" {
		return nil, "", fmt.Errorf("no verified tokenizer for model")
	}
	if t.Python == "" {
		return nil, "", fmt.Errorf("tokenizer runtime unavailable")
	}
	data, err := json.Marshal(texts)
	if err != nil {
		return nil, "", err
	}
	key := sha256.Sum256(data)
	t.mu.Lock()
	if t.gate == nil {
		t.gate = make(chan struct{}, 2)
	}
	cached, found := t.cache[key]
	gate := t.gate
	t.mu.Unlock()
	if found {
		return append([]int64{}, cached...), "deepseek-v4@8f9f37ca37fd", nil
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	select {
	case gate <- struct{}{}:
		defer func() { <-gate }()
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
	command := exec.CommandContext(ctx, t.Python, t.Script)
	command.Stdin = bytes.NewReader(data)
	output, err := command.Output()
	if err != nil {
		return nil, "", fmt.Errorf("tokenizer unavailable: %w", err)
	}
	var counts []int64
	if err = json.Unmarshal(output, &counts); err != nil {
		return nil, "", err
	}
	if len(counts) != len(texts) {
		return nil, "", fmt.Errorf("tokenizer result length mismatch")
	}
	for _, n := range counts {
		if n < 0 {
			return nil, "", fmt.Errorf("invalid tokenizer count")
		}
	}
	t.mu.Lock()
	if len(t.cache) >= 32 || t.cache == nil {
		t.cache = make(map[[32]byte][]int64)
	}
	t.cache[key] = append([]int64{}, counts...)
	t.mu.Unlock()
	return counts, "deepseek-v4@8f9f37ca37fd", nil
}
