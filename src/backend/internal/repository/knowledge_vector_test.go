package repository

import (
	"math"
	"strings"
	"testing"
)

func TestEmbeddingVectorLiteral(t *testing.T) {
	values := make([]float32, 1024)
	values[0] = 0.25
	values[1023] = -0.5

	literal, err := embeddingVectorLiteral(values)
	if err != nil {
		t.Fatalf("embeddingVectorLiteral() error = %v", err)
	}
	got, ok := literal.(string)
	if !ok {
		t.Fatalf("embeddingVectorLiteral() type = %T, want string", literal)
	}
	if !strings.HasPrefix(got, "[0.25,") || !strings.HasSuffix(got, ",-0.5]") {
		t.Fatalf("embeddingVectorLiteral() returned malformed vector: %q", got)
	}
}

func TestEmbeddingVectorLiteralRejectsInvalidVectors(t *testing.T) {
	if _, err := embeddingVectorLiteral(make([]float32, 3)); err == nil {
		t.Fatal("embeddingVectorLiteral() accepted wrong dimensions")
	}

	values := make([]float32, 1024)
	values[12] = float32(math.NaN())
	if _, err := embeddingVectorLiteral(values); err == nil {
		t.Fatal("embeddingVectorLiteral() accepted NaN")
	}
}

func TestEmbeddingVectorLiteralAllowsMissingEmbedding(t *testing.T) {
	literal, err := embeddingVectorLiteral(nil)
	if err != nil {
		t.Fatalf("embeddingVectorLiteral(nil) error = %v", err)
	}
	if literal != nil {
		t.Fatalf("embeddingVectorLiteral(nil) = %#v, want nil", literal)
	}
}
