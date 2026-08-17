package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type fakeCheckpointHandlerService struct {
	createInput model.CreateCheckpointInput
	createErr   error
}

func (f *fakeCheckpointHandlerService) Create(_ context.Context, input model.CreateCheckpointInput) (*model.ConversationCheckpoint, error) {
	f.createInput = input
	if f.createErr != nil {
		return nil, f.createErr
	}
	return &model.ConversationCheckpoint{ID: "checkpoint-1", Status: model.CheckpointStatusGenerating}, nil
}

func (*fakeCheckpointHandlerService) List(context.Context, string, string, int) ([]model.ConversationCheckpoint, error) {
	return []model.ConversationCheckpoint{}, nil
}

func (*fakeCheckpointHandlerService) Get(context.Context, string, string, string) (*model.ConversationCheckpoint, error) {
	return &model.ConversationCheckpoint{ID: "checkpoint-1"}, nil
}

func (*fakeCheckpointHandlerService) Delete(context.Context, string, string, string) error {
	return nil
}

func checkpointTestRouter(handler *ConversationCheckpointHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", "user-1")
		c.Next()
	})
	router.POST("/conversations/:id/checkpoints", handler.Create)
	return router
}

func TestConversationCheckpointHandlerCreateContract(t *testing.T) {
	serviceFake := &fakeCheckpointHandlerService{}
	router := checkpointTestRouter(NewConversationCheckpointHandler(serviceFake))
	request := httptest.NewRequest(http.MethodPost, "/conversations/conv-1/checkpoints",
		strings.NewReader(`{"agent_id":"agent-1","scope":"conversation_shared"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if serviceFake.createInput.ConversationID != "conv-1" || serviceFake.createInput.SourceAgentID != "agent-1" || serviceFake.createInput.CreatedBy != "user-1" {
		t.Fatalf("unexpected service input: %#v", serviceFake.createInput)
	}
	var body struct {
		Data model.ConversationCheckpoint `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Data.Status != model.CheckpointStatusGenerating {
		t.Fatalf("unexpected response: %s, err=%v", response.Body.String(), err)
	}
}

func TestConversationCheckpointHandlerMapsAgentBindingConflict(t *testing.T) {
	serviceFake := &fakeCheckpointHandlerService{createErr: service.ErrCheckpointAgentBound}
	router := checkpointTestRouter(NewConversationCheckpointHandler(serviceFake))
	request := httptest.NewRequest(http.MethodPost, "/conversations/conv-1/checkpoints",
		strings.NewReader(`{"agent_id":"agent-2"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.Code)
	}
}

func TestConversationCheckpointHandlerRejectsMissingAgent(t *testing.T) {
	serviceFake := &fakeCheckpointHandlerService{createErr: errors.New("must not be called")}
	router := checkpointTestRouter(NewConversationCheckpointHandler(serviceFake))
	request := httptest.NewRequest(http.MethodPost, "/conversations/conv-1/checkpoints", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}
