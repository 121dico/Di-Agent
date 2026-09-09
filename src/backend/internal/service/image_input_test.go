package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

func TestImageAttachmentsContainBytes(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "originals"), 0700); err != nil {
		t.Fatal(err)
	}
	name := strings.Repeat("a", 64) + ".png"
	storagePath := "uploads/originals/" + name
	data := []byte("\x89PNG\r\n\x1a\nimage-fixture")
	if err := os.WriteFile(filepath.Join(dir, "originals", name), data, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := buildImageInputs(context.Background(), []model.MessageAttachment{{FilePath: storagePath, MimeType: "image/png"}}, dir)
	if err != nil || len(got) != 1 || got[0].Data == "" {
		t.Fatalf("actual image bytes missing: %v %v", got, err)
	}
	_, err = buildImageInputs(context.Background(), []model.MessageAttachment{{FilePath: "../a.png", MimeType: "image/png"}}, dir)
	if err == nil {
		t.Fatal("accepted traversal")
	}
	decoded, _ := base64.StdEncoding.DecodeString(got[0].Data)
	if string(decoded) != string(data) {
		t.Fatal("did not preserve original bytes")
	}
	out := t.TempDir()
	if err := os.WriteFile(filepath.Join(out, "secret.png"), data, 0600); err != nil {
		t.Fatal(err)
	}
	escapeName := strings.Repeat("b", 64) + ".png"
	if err := os.Symlink(filepath.Join(out, "secret.png"), filepath.Join(dir, "originals", escapeName)); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"uploads/originals/" + escapeName, "escape.png", filepath.Join(out, "secret.png"), "https://example.com/a.png"} {
		if _, err := buildImageInputs(context.Background(), []model.MessageAttachment{{FilePath: p, MimeType: "image/png"}}, dir); err == nil {
			t.Fatalf("accepted unsafe path %s", p)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "originals", name), append(data, make([]byte, 4<<20)...), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := buildImageInputs(context.Background(), []model.MessageAttachment{{FilePath: storagePath, MimeType: "image/png"}}, dir); err == nil {
		t.Fatal("accepted oversized image")
	}
}

type imageSourceFake struct{ message *model.Message }

func TestUploadedImageReachesDispatchBytes(t *testing.T) {
	var original bytes.Buffer
	if err := png.Encode(&original, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", "clipboard.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(original.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	form, err := multipart.NewReader(&body, w.Boundary()).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}
	defer form.RemoveAll()
	dir := t.TempDir()
	upload, err := NewUploadService(UploadConfig{Dir: dir}).ProcessUpload(context.Background(), form.File["file"][0])
	if err != nil {
		t.Fatal(err)
	}
	id := "source"
	got, err := sourceImageInputs(context.Background(), imageSourceFake{&model.Message{ConversationID: "conv", Attachments: []model.MessageAttachment{upload.ToMessageAttachment()}}}, "conv", &id, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatal("image not delivered")
	}
	data, _ := base64.StdEncoding.DecodeString(got[0].Data)
	if !bytes.Equal(data, original.Bytes()) {
		t.Fatal("uploaded bytes not preserved")
	}
	for _, supported := range []bool{true, false} {
		t.Run(fmt.Sprint("dispatch-capability-", supported), func(t *testing.T) {
			ch := make(chan *ws.TaskResult, 1)
			ch <- &ws.TaskResult{TaskID: "image-task", Result: "seen"}
			hub := &imageDispatchHub{supported: supported, fakeDaemonDispatcher: &fakeDaemonDispatcher{isConnected: func(string) bool { return true }, registerTaskPromise: func(string) chan *ws.TaskResult { return ch }, awaitTaskResult: func(string) chan *ws.TaskResult { return ch }, removeTaskPromise: func(string) {}}}
			repo := &fakeMsgRepo{messages: []model.Message{{ID: id, ConversationID: "conv", Role: "user", Attachments: []model.MessageAttachment{upload.ToMessageAttachment()}}}}
			agent := &model.Agent{ID: "image-agent", Name: "Claude", CLITool: "claude", MachineID: stringPtr("machine")}
			d := NewDispatcher(DispatcherDeps{MsgRepo: repo, UploadDir: dir, DaemonHub: hub, AgentRepo: &fakeOrchAgentRepo{agent: agent, task: &model.DaemonTask{ID: "image-task", Status: "pending"}}})
			_, err := d.Dispatch(context.Background(), DispatchInput{ConvID: "conv", UserID: "u", Agent: agent, Prompt: "", ReplyTo: &id}, DispatchHooks{})
			if !supported {
				if err == nil || hub.sent != nil {
					t.Fatalf("old daemon must fail before dispatch: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			payload := hub.sent.Data.(map[string]interface{})
			images := payload["images"].([]imageInput)
			if payload["prompt"] != "" || len(images) != 1 || images[0].Data != got[0].Data {
				t.Fatal("image-only dispatch did not deliver exact uploaded bytes")
			}
		})
	}
}

type imageDispatchHub struct {
	*fakeDaemonDispatcher
	supported bool
	sent      *ws.WSMessage
}

func (h *imageDispatchHub) SupportsCapability(_, capability string) bool {
	return h.supported && capability == "image_inputs_v1"
}
func (h *imageDispatchHub) SendToMachineRequiringCapability(_ string, capability string, msg ws.WSMessage) error {
	if !h.SupportsCapability("", capability) {
		return fmt.Errorf("unsupported")
	}
	h.sent = &msg
	return nil
}

func (f imageSourceFake) GetByID(context.Context, string) (*model.Message, error) {
	return f.message, nil
}
func TestImageSourceRequiresSameConversation(t *testing.T) {
	id := "message"
	_, err := sourceImageInputs(context.Background(), imageSourceFake{&model.Message{ConversationID: "other"}}, "current", &id, t.TempDir())
	if err == nil {
		t.Fatal("accepted cross conversation image source")
	}
}
