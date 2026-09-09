package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

func TestReturnedImageRequiresAssignedMachineAndPreservesSharedAgentReply(t *testing.T) {
	for _, machineID := range []string{"assigned", "other"} {
		t.Run(machineID, func(t *testing.T) {
			h, hub, repo := newTestDaemonHandler(t)
			repo.daemonTask = &model.DaemonTask{ID: "task", UserID: "requesting-user", MachineID: "assigned", ConversationID: "conv"}
			h.SetImageUploads(service.NewUploadService(service.UploadConfig{Dir: t.TempDir()}))
			var data bytes.Buffer
			if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
				t.Fatal(err)
			}
			payload, _ := json.Marshal(map[string]interface{}{"task_id": "task", "result": "answer", "artifacts": []ws.ArtifactResult{{Type: "image", Filename: "image.png", Content: "data:image/png;base64," + base64.StdEncoding.EncodeToString(data.Bytes())}}})
			ch := hub.RegisterTaskPromise("task")
			h.handleTaskComplete(payload, &model.DaemonMachine{ID: machineID, UserID: "different-machine-owner"})
			if machineID == "other" {
				if len(repo.lifecycleCalls) != 0 {
					t.Fatal("unauthorized machine completed image task")
				}
				return
			}
			select {
			case result := <-ch:
				if result.Result != "answer" || len(result.Artifacts) != 1 || result.Artifacts[0].Content != "" || !strings.HasPrefix(result.Artifacts[0].URL, "/api/uploads/") {
					t.Fatalf("image reply missing: %#v", result)
				}
			default:
				t.Fatal("assigned shared Agent did not finish")
			}
		})
	}
}

func TestMalformedReturnedImageKeepsNormalAnswer(t *testing.T) {
	h, hub, repo := newTestDaemonHandler(t)
	repo.daemonTask = &model.DaemonTask{ID: "task", MachineID: "machine", ConversationID: "conv"}
	h.SetImageUploads(service.NewUploadService(service.UploadConfig{Dir: t.TempDir()}))
	ch := hub.RegisterTaskPromise("task")
	h.handleTaskComplete(json.RawMessage(`{"task_id":"task","result":"normal answer","artifacts":[{"type":"image","content":"not an image"}]}`), &model.DaemonMachine{ID: "machine"})
	select {
	case result := <-ch:
		if !strings.Contains(result.Result, "normal answer") || !strings.Contains(result.Result, "图片未能返回") || len(result.Artifacts) != 0 {
			t.Fatal("lost successful normal answer")
		}
	default:
		t.Fatal("completion lost")
	}
}
