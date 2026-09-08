package service

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// TestSplitTextBlocksByCardFences 覆盖 PRD Step 2 列出的所有 case：
//   - 单 text block 无 fence → 原样返回
//   - 单 text block 含一个 fence → 切成 [before, card, after]（before/after 可能为空，跳过）
//   - 单 text block 含多个 fence → 切成多段
//   - 多个 text block 混合 thinking block → 非 text block 位置不变
//   - text block 跨 fence 但 fence 未闭合 → 原样返回（不部分切分）
//   - 多张卡在同一 fence → 每张卡独立 card block
//   - Index 重新编号（单调递增无空洞）
func TestSplitTextBlocksByCardFences(t *testing.T) {
	cases := []struct {
		name   string
		input  []model.MessageBlock
		expect []model.MessageBlock
	}{
		{
			name:   "empty input",
			input:  []model.MessageBlock{},
			expect: []model.MessageBlock{},
		},
		{
			name: "single text block no fence → unchanged (kind text)",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "hello world"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "hello world"},
			},
		},
		{
			name: "non-text block passthrough",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindThinking, Text: "thinking"},
				{Index: 1, Kind: model.BlockKindToolUse, Text: "tool input", ToolName: "Read"},
				{Index: 2, Kind: model.BlockKindToolResult, Text: "tool output"},
				{Index: 3, Kind: model.BlockKindError, Text: "err", IsError: true},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindThinking, Text: "thinking"},
				{Index: 1, Kind: model.BlockKindToolUse, Text: "tool input", ToolName: "Read"},
				{Index: 2, Kind: model.BlockKindToolResult, Text: "tool output"},
				{Index: 3, Kind: model.BlockKindError, Text: "err", IsError: true},
			},
		},
		{
			name: "text with single fence in middle → [before, card, after]",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "before\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"c1\"}]}\n```\nafter"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "before"},
				{Index: 1, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "c1"}},
				{Index: 2, Kind: model.BlockKindText, Text: "after"},
			},
		},
		{
			name: "retired fence remains readable during upgrade",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "before\n```agenthub\n{\"cards\":[{\"type\":\"info\",\"id\":\"legacy\"}]}\n```\nafter"}, // [brand-compat]
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "before"},
				{Index: 1, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "legacy"}},
				{Index: 2, Kind: model.BlockKindText, Text: "after"},
			},
		},
		{
			name: "text with fence at start → [card, after] (empty before trimmed)",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"c1\"}]}\n```\nafter"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "c1"}},
				{Index: 1, Kind: model.BlockKindText, Text: "after"},
			},
		},
		{
			name: "text with multiple fences → interleaved",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "intro\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"a\"}]}\n```\nmiddle\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"b\"}]}\n```\nending"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "intro"},
				{Index: 1, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "a"}},
				{Index: 2, Kind: model.BlockKindText, Text: "middle"},
				{Index: 3, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "b"}},
				{Index: 4, Kind: model.BlockKindText, Text: "ending"},
			},
		},
		{
			name: "fence with multiple cards → N independent card blocks",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"a\"},{\"type\":\"info\",\"id\":\"b\"},{\"type\":\"info\",\"id\":\"c\"}]}\n```"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "a"}},
				{Index: 1, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "b"}},
				{Index: 2, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "c"}},
			},
		},
		{
			name: "unclosed fence → original text preserved (no partial split)",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "before\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"c1\"}]}"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "before\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"c1\"}]}"},
			},
		},
		{
			name: "fence with invalid JSON → preserved verbatim",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "```di_agent\nnot json\n```\nafter"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "```di_agent\nnot json\n```\nafter"},
			},
		},
		{
			name: "fence with no cards field → preserved verbatim",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "```di_agent\n{\"foo\":1}\n```\nafter"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "```di_agent\n{\"foo\":1}\n```\nafter"},
			},
		},
		{
			name: "text + thinking + text-with-card → all preserved in order, text split",
			input: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "intro"},
				{Index: 1, Kind: model.BlockKindThinking, Text: "let me think"},
				{Index: 2, Kind: model.BlockKindText, Text: "result:\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"x\"}]}\n```\ndone"},
			},
			expect: []model.MessageBlock{
				{Index: 0, Kind: model.BlockKindText, Text: "intro"},
				{Index: 1, Kind: model.BlockKindThinking, Text: "let me think"},
				{Index: 2, Kind: model.BlockKindText, Text: "result:"},
				{Index: 3, Kind: model.BlockKindCard, Card: map[string]any{"type": "info", "id": "x"}},
				{Index: 4, Kind: model.BlockKindText, Text: "done"},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SplitTextBlocksByCardFences(tc.input)
			if !reflect.DeepEqual(got, tc.expect) {
				t.Fatalf("SplitTextBlocksByCardFences mismatch\n got:  %+v\n want: %+v", got, tc.expect)
			}
		})
	}
}

// TestSplitTextBlocksByCardFencesIndexRenumber 验证 Index 重新编号保证单调递增无空洞。
func TestSplitTextBlocksByCardFencesIndexRenumber(t *testing.T) {
	input := []model.MessageBlock{
		{Index: 5, Kind: model.BlockKindText, Text: "first"},
		{Index: 9, Kind: model.BlockKindThinking, Text: "thinking"},
		{Index: 17, Kind: model.BlockKindText, Text: "```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"a\"}]}\n```"},
	}
	got := SplitTextBlocksByCardFences(input)
	for i, b := range got {
		if b.Index != i {
			t.Errorf("block %d has Index=%d, want %d", i, b.Index, i)
		}
	}
}

// TestSnapshotBlocksJSONFromBufferAppliesCardSplit 集成验证：
// snapshotBlocksJSONFromBuffer（dispatcher 包级函数）在序列化前调用了 SplitTextBlocksByCardFences，
// 所以从 buffer snapshot 出来的 JSON 含 card kind block（而非 text 里的 fenced JSON 原文）。
func TestSnapshotBlocksJSONFromBufferAppliesCardSplit(t *testing.T) {
	buf := NewStreamingBuffer()
	const taskID = "task-card-split"
	buf.PushEvents(taskID, []model.AgentEvent{
		{Type: model.AgentEventText, Content: "intro"},
	})
	buf.PushEvents(taskID, []model.AgentEvent{
		{Type: model.AgentEventText, Content: "\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"c1\"}]}\n```\n"},
	})
	buf.PushEvents(taskID, []model.AgentEvent{
		{Type: model.AgentEventText, Content: "outro"},
	})

	jsonStr := snapshotBlocksJSONFromBuffer(buf, taskID)
	if jsonStr == "" {
		t.Fatal("expected non-empty blocks json")
	}
	// 反序列化验证：blocks 含 text + card + text 三段
	var blocks []model.MessageBlock
	if err := json.Unmarshal([]byte(jsonStr), &blocks); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	wantKinds := []model.BlockKind{model.BlockKindText, model.BlockKindCard, model.BlockKindText}
	if len(blocks) != len(wantKinds) {
		t.Fatalf("expected %d blocks, got %d: %+v", len(wantKinds), len(blocks), blocks)
	}
	for i, want := range wantKinds {
		if blocks[i].Kind != want {
			t.Errorf("block[%d].Kind = %s, want %s", i, blocks[i].Kind, want)
		}
	}
}

func TestFinalizedPlainTextRetainsObservedTimeRange(t *testing.T) {
	var events []model.AgentEvent
	if err := json.Unmarshal([]byte(`[{"type":"text","content":"I will check","ts":"2026-09-08T09:00:00Z"},{"type":"text","content":" the skill","ts":"2026-09-08T09:00:01Z"},{"type":"tool_use","tool":"get_agent_skill","tool_use_id":"skill","ts":"2026-09-08T09:00:02Z"},{"type":"tool_result","tool_use_id":"skill","output":"loaded","ts":"2026-09-08T09:00:03Z"},{"type":"text","content":"Done","ts":"2026-09-08T09:00:04Z"}]`), &events); err != nil {
		t.Fatal(err)
	}
	buf := NewStreamingBuffer()
	buf.PushEvents("timed-reply", events)
	wire := snapshotBlocksJSONFromBuffer(buf, "timed-reply")
	var blocks []model.MessageBlock
	if err := json.Unmarshal([]byte(wire), &blocks); err != nil {
		t.Fatal(err)
	}
	if len(blocks) != 4 || blocks[0].StartedAt != "2026-09-08T09:00:00Z" || blocks[0].EndedAt != "2026-09-08T09:00:01Z" || blocks[3].StartedAt != "2026-09-08T09:00:04Z" || blocks[3].EndedAt != "2026-09-08T09:00:04Z" {
		t.Fatalf("finalized public text lost observed range: %s", wire)
	}
}

func TestCardSplitRetainsOnlyKnownOuterTimeBoundaries(t *testing.T) {
	source := model.MessageBlock{Kind: model.BlockKindText, Text: "intro\n```di_agent\n{\"cards\":[{\"type\":\"info\",\"id\":\"c1\"}]}\n```\noutro", StartedAt: "2026-09-08T09:00:00Z", EndedAt: "2026-09-08T09:00:05Z"}
	blocks := SplitTextBlocksByCardFences([]model.MessageBlock{source})
	if len(blocks) != 3 || blocks[0].StartedAt != source.StartedAt || blocks[2].EndedAt != source.EndedAt {
		t.Fatalf("known boundaries lost: %+v", blocks)
	}
	if blocks[0].EndedAt != "" || blocks[1].StartedAt != "" || blocks[1].EndedAt != "" || blocks[2].StartedAt != "" {
		t.Fatalf("invented split-specific duration: %+v", blocks)
	}
}
