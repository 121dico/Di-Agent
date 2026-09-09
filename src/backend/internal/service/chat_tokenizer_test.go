package service

import (
	"context"
	"os"
	"reflect"
	"testing"
)

func TestOfficialTextTokenizer(t *testing.T) {
	tokenizer := &OfficialChatTokenizer{Python: os.Getenv("DI_AGENT_TOKENIZER_PYTHON"), Script: "../../tokenizers/count.py"}
	if _, _, err := tokenizer.Count(context.Background(), "unknown", []string{"hello"}); err == nil {
		t.Fatal("unknown model cannot use arbitrary vocabulary")
	}
	if tokenizer.Python == "" {
		t.Skip("official tokenizer integration requires DI_AGENT_TOKENIZER_PYTHON")
	}
	texts := []string{"你好", "test", "hello", "你好世界", "👋"}
	counts, version, err := tokenizer.Count(context.Background(), "deepseek-v4-pro", texts)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(counts, []int64{1, 1, 1, 2, 2}) || version != "deepseek-v4@8f9f37ca37fd" {
		t.Fatalf("unexpected tokenization: %v %s", counts, version)
	}
	counts[0] = 999
	again, _, err := tokenizer.Count(context.Background(), "deepseek-v4-flash", texts)
	if err != nil || again[0] != 1 {
		t.Fatal("cached count must not be mutable by callers")
	}
}
