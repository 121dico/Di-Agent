package service

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

func TestReturnedImageDaemonToStoredArtifact(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node required for cross-runtime image regression")
	}
	dir := t.TempDir()
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	data.WriteString("private trailing metadata")
	file := filepath.Join(dir, "diagram.png")
	if err := os.WriteFile(file, data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../../../daemon-npm/cli/image-output.js")
	if err != nil {
		t.Fatal(err)
	}
	payload, err := exec.Command(node, "-e", `const {collectImageOutputs}=require(process.argv[1]); process.stdout.write(JSON.stringify(collectImageOutputs('![diagram](<'+process.argv[3]+'>)',process.argv[2])));`, helper, dir, file).Output()
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Text      string              `json:"text"`
		Artifacts []ws.ArtifactResult `json:"artifacts"`
	}
	if err := json.Unmarshal(payload, &wire); err != nil {
		t.Fatal(err)
	}
	store := t.TempDir()
	svc := NewUploadService(UploadConfig{Dir: store})
	persisted, err := svc.PersistReturnedImages(context.Background(), wire.Artifacts)
	if err != nil {
		t.Fatal(err)
	}
	artifacts := artifactsFromTaskResult(persisted)
	if len(artifacts) != 1 || artifacts[0].Type != "image" || artifacts[0].Content != "" || !strings.HasPrefix(artifacts[0].URL, "/api/uploads/originals/") {
		t.Fatalf("missing persisted image: %#v", artifacts)
	}
	stored, err := os.ReadFile(filepath.Join(store, "originals", filepath.Base(artifacts[0].URL)))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte("private trailing metadata")) {
		t.Fatal("preserved non-image data")
	}
	decoded, err := png.Decode(bytes.NewReader(stored))
	if err != nil {
		t.Fatal(err)
	}
	r, _, _, _ := decoded.At(0, 0).RGBA()
	if r != 65535 {
		t.Fatal("image pixels changed")
	}
	_, err = svc.PersistReturnedImages(context.Background(), []ws.ArtifactResult{{Type: "image", Content: "data:image/png;base64,c2VjcmV0"}})
	if err == nil {
		t.Fatal("accepted fake image")
	}
}
