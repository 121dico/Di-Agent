package rag

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	defaultSemanticThreshold = 0.72
	defaultTargetChunkChars  = 900
	defaultMaxChunkChars     = 1400
	defaultChunkOverlapChars = 150
	defaultMinChunkChars     = 180
	defaultSummaryMaxChars   = 360
)

var markdownHeadingPattern = regexp.MustCompile(`^#{1,6}\s+`)

type Chunker struct {
	config   Config
	embedder Embedder
}

func NewChunker(config Config, embedder Embedder) *Chunker {
	return &Chunker{config: normalizeConfig(config), embedder: embedder}
}

// Chunk 按“摘要 -> 语义 -> 字符串兜底”生成片段。
// 向量服务失败时 chunks 仍可持久化，调用方通过 error 暴露降级状态。
func (c *Chunker) Chunk(ctx context.Context, text string) ([]Chunk, error) {
	normalized := normalizeText(text)
	if normalized == "" {
		return nil, nil
	}

	summary := extractSummary(normalized, c.config.SummaryMaxChars)
	chunks := []Chunk{{Type: ChunkTypeSummary, Content: summary, Summary: summary}}
	units := semanticUnits(normalized)
	if c.embedder == nil {
		chunks = append(chunks, c.fallbackChunks(normalized, summary)...)
		return indexChunks(chunks), ErrEmbeddingUnavailable
	}

	vectors, err := c.embedder.Embed(ctx, units)
	if err != nil {
		chunks = append(chunks, c.fallbackChunks(normalized, summary)...)
		return indexChunks(chunks), fmt.Errorf("embed semantic units: %w", err)
	}
	if err := validateVectors(vectors, len(units)); err != nil {
		chunks = append(chunks, c.fallbackChunks(normalized, summary)...)
		return indexChunks(chunks), err
	}

	for _, content := range c.semanticChunks(units, vectors) {
		if runeCount(content) > c.config.MaxChunkChars {
			for _, part := range recursiveStringChunks(content, c.config.MaxChunkChars, c.config.ChunkOverlapChars) {
				chunks = append(chunks, Chunk{Type: ChunkTypeString, Content: part, Summary: extractSummary(part, c.config.SummaryMaxChars)})
			}
			continue
		}
		chunks = append(chunks, Chunk{Type: ChunkTypeSemantic, Content: content, Summary: extractSummary(content, c.config.SummaryMaxChars)})
	}

	return indexChunks(chunks), nil
}

func normalizeConfig(config Config) Config {
	if config.SemanticThreshold <= 0 || config.SemanticThreshold >= 1 {
		config.SemanticThreshold = defaultSemanticThreshold
	}
	if config.TargetChunkChars <= 0 {
		config.TargetChunkChars = defaultTargetChunkChars
	}
	if config.MaxChunkChars <= 0 {
		config.MaxChunkChars = defaultMaxChunkChars
	}
	if config.TargetChunkChars > config.MaxChunkChars {
		config.TargetChunkChars = config.MaxChunkChars
	}
	if config.ChunkOverlapChars < 0 {
		config.ChunkOverlapChars = 0
	}
	if config.ChunkOverlapChars == 0 {
		config.ChunkOverlapChars = defaultChunkOverlapChars
	}
	if config.ChunkOverlapChars >= config.MaxChunkChars {
		config.ChunkOverlapChars = config.MaxChunkChars / 10
	}
	if config.MinChunkChars <= 0 {
		config.MinChunkChars = defaultMinChunkChars
	}
	if config.MinChunkChars > config.TargetChunkChars {
		config.MinChunkChars = config.TargetChunkChars / 2
	}
	if config.SummaryMaxChars <= 0 {
		config.SummaryMaxChars = defaultSummaryMaxChars
	}
	return config
}

func normalizeText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func semanticUnits(text string) []string {
	paragraphs := splitNonEmpty(text, "\n\n")
	units := make([]string, 0, len(paragraphs))
	for _, paragraph := range paragraphs {
		if isHeading(paragraph) {
			units = append(units, paragraph)
			continue
		}
		units = append(units, splitSentences(paragraph)...)
	}
	if len(units) == 0 {
		return []string{text}
	}
	return units
}

func (c *Chunker) semanticChunks(units []string, vectors [][]float32) []string {
	groups := make([]string, 0, len(units))
	current := units[0]
	for i := 1; i < len(units); i++ {
		next := units[i]
		currentChars := runeCount(current)
		combinedChars := currentChars + 2 + runeCount(next)
		similarity := cosineSimilarity(vectors[i-1], vectors[i])
		semanticBoundary := similarity < c.config.SemanticThreshold && currentChars >= c.config.MinChunkChars
		sizeBoundary := combinedChars > c.config.TargetChunkChars && currentChars >= c.config.MinChunkChars
		if semanticBoundary || sizeBoundary {
			groups = append(groups, strings.TrimSpace(current))
			current = next
			continue
		}
		current += "\n\n" + next
	}
	if strings.TrimSpace(current) != "" {
		groups = append(groups, strings.TrimSpace(current))
	}
	return mergeTinyGroups(groups, c.config.MinChunkChars, c.config.MaxChunkChars)
}

func (c *Chunker) fallbackChunks(text, summary string) []Chunk {
	parts := recursiveStringChunks(text, c.config.MaxChunkChars, c.config.ChunkOverlapChars)
	chunks := make([]Chunk, 0, len(parts))
	for _, part := range parts {
		partSummary := extractSummary(part, c.config.SummaryMaxChars)
		if partSummary == "" {
			partSummary = summary
		}
		chunks = append(chunks, Chunk{Type: ChunkTypeString, Content: part, Summary: partSummary})
	}
	return chunks
}

func validateVectors(vectors [][]float32, want int) error {
	if len(vectors) != want {
		return fmt.Errorf("%w: got %d vectors for %d inputs", ErrInvalidEmbedding, len(vectors), want)
	}
	dimensions := 0
	for i, vector := range vectors {
		if len(vector) == 0 {
			return fmt.Errorf("%w: vector %d is empty", ErrInvalidEmbedding, i)
		}
		if dimensions == 0 {
			dimensions = len(vector)
		}
		if len(vector) != dimensions {
			return fmt.Errorf("%w: vector %d has %d dimensions, want %d", ErrInvalidEmbedding, i, len(vector), dimensions)
		}
	}
	return nil
}

func cosineSimilarity(a, b []float32) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		av, bv := float64(a[i]), float64(b[i])
		dot += av * bv
		normA += av * av
		normB += bv * bv
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

func extractSummary(text string, maxChars int) string {
	text = strings.TrimSpace(text)
	if runeCount(text) <= maxChars {
		return text
	}
	lines := strings.Split(text, "\n")
	title := ""
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if isHeading(line) || runeCount(line) <= 80 {
			title = strings.TrimSpace(markdownHeadingPattern.ReplaceAllString(line, ""))
		}
		break
	}

	sentences := splitSentences(strings.ReplaceAll(text, "\n", " "))
	type candidate struct {
		text  string
		score float64
		order int
	}
	frequency := tokenFrequency(text)
	candidates := make([]candidate, 0, len(sentences))
	for i, sentence := range sentences {
		score := 1 / float64(i+1)
		for _, token := range summaryTokens(sentence) {
			score += float64(frequency[token])
		}
		candidates = append(candidates, candidate{text: sentence, score: score, order: i})
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].score > candidates[j].score })
	if len(candidates) > 3 {
		candidates = candidates[:3]
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].order < candidates[j].order })

	parts := make([]string, 0, 4)
	if title != "" {
		parts = append(parts, title)
	}
	for _, item := range candidates {
		if item.text != title {
			parts = append(parts, item.text)
		}
	}
	return truncateRunes(strings.Join(parts, " "), maxChars)
}

func tokenFrequency(text string) map[string]int {
	frequency := make(map[string]int)
	for _, token := range summaryTokens(text) {
		frequency[token]++
	}
	return frequency
}

func summaryTokens(text string) []string {
	var tokens []string
	var word strings.Builder
	var han []rune
	flushWord := func() {
		if word.Len() > 1 {
			tokens = append(tokens, strings.ToLower(word.String()))
		}
		word.Reset()
	}
	flushHan := func() {
		if len(han) == 1 {
			tokens = append(tokens, string(han))
		} else {
			for i := 0; i+1 < len(han); i++ {
				tokens = append(tokens, string(han[i:i+2]))
			}
		}
		han = han[:0]
	}
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Han):
			flushWord()
			han = append(han, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushHan()
			word.WriteRune(r)
		default:
			flushWord()
			flushHan()
		}
	}
	flushWord()
	flushHan()
	return tokens
}

func splitSentences(text string) []string {
	var result []string
	var current strings.Builder
	for _, r := range text {
		current.WriteRune(r)
		if strings.ContainsRune("。！？!?；;", r) || (r == '.' && current.Len() > 20) {
			if sentence := strings.TrimSpace(current.String()); sentence != "" {
				result = append(result, sentence)
			}
			current.Reset()
		}
	}
	if sentence := strings.TrimSpace(current.String()); sentence != "" {
		result = append(result, sentence)
	}
	return result
}

func recursiveStringChunks(text string, maxChars, overlap int) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	return recursiveSplit(text, []string{"\n\n", "\n", "。", "！", "？", ". ", " ", ""}, maxChars, overlap)
}

func recursiveSplit(text string, separators []string, maxChars, overlap int) []string {
	if runeCount(text) <= maxChars {
		return []string{text}
	}
	if len(separators) == 0 || separators[0] == "" {
		return slidingRuneChunks(text, maxChars, overlap)
	}
	separator := separators[0]
	pieces := splitKeepingSeparator(text, separator)
	if len(pieces) == 1 {
		return recursiveSplit(text, separators[1:], maxChars, overlap)
	}

	var result []string
	var current string
	flush := func() {
		if strings.TrimSpace(current) != "" {
			result = append(result, strings.TrimSpace(current))
		}
		current = ""
	}
	for _, piece := range pieces {
		piece = strings.TrimSpace(piece)
		if piece == "" {
			continue
		}
		if runeCount(piece) > maxChars {
			flush()
			result = append(result, recursiveSplit(piece, separators[1:], maxChars, overlap)...)
			continue
		}
		candidate := piece
		if current != "" {
			candidate = current + separator + piece
		}
		if runeCount(candidate) <= maxChars {
			current = candidate
			continue
		}
		previous := current
		flush()
		prefix := tailRunes(previous, overlap)
		if prefix != "" && runeCount(prefix+separator+piece) <= maxChars {
			current = prefix + separator + piece
		} else {
			current = piece
		}
	}
	flush()
	return result
}

func splitKeepingSeparator(text, separator string) []string {
	raw := strings.Split(text, separator)
	pieces := make([]string, 0, len(raw))
	for i, piece := range raw {
		if i < len(raw)-1 && separator != " " && separator != "\n" && separator != "\n\n" && separator != ". " {
			piece += separator
		}
		pieces = append(pieces, piece)
	}
	return pieces
}

func slidingRuneChunks(text string, maxChars, overlap int) []string {
	runes := []rune(text)
	step := maxChars - overlap
	if step <= 0 {
		step = maxChars
	}
	chunks := make([]string, 0, (len(runes)+step-1)/step)
	for start := 0; start < len(runes); start += step {
		end := start + maxChars
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, strings.TrimSpace(string(runes[start:end])))
		if end == len(runes) {
			break
		}
	}
	return chunks
}

func mergeTinyGroups(groups []string, minChars, maxChars int) []string {
	if len(groups) < 2 {
		return groups
	}
	merged := make([]string, 0, len(groups))
	for _, group := range groups {
		if len(merged) > 0 && runeCount(group) < minChars {
			candidate := merged[len(merged)-1] + "\n\n" + group
			if runeCount(candidate) <= maxChars {
				merged[len(merged)-1] = candidate
				continue
			}
		}
		merged = append(merged, group)
	}
	return merged
}

func indexChunks(chunks []Chunk) []Chunk {
	for i := range chunks {
		chunks[i].Index = i
		chunks[i].CharCount = runeCount(chunks[i].Content)
	}
	return chunks
}

func isHeading(text string) bool {
	trimmed := strings.TrimSpace(text)
	return markdownHeadingPattern.MatchString(trimmed) || (!strings.Contains(trimmed, "\n") && runeCount(trimmed) <= 80 && !endsSentence(trimmed))
}

func endsSentence(text string) bool {
	text = strings.TrimSpace(text)
	return strings.HasSuffix(text, "。") || strings.HasSuffix(text, ".") || strings.HasSuffix(text, "！") || strings.HasSuffix(text, "？") || strings.HasSuffix(text, "!") || strings.HasSuffix(text, "?")
}

func splitNonEmpty(text, separator string) []string {
	raw := strings.Split(text, separator)
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func runeCount(text string) int { return utf8.RuneCountInString(text) }

func truncateRunes(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return strings.TrimSpace(string(runes[:max]))
}

func tailRunes(text string, count int) string {
	if count <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= count {
		return text
	}
	return strings.TrimSpace(string(runes[len(runes)-count:]))
}
