package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type imageInput struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}
type imageMessageReader interface {
	GetByID(context.Context, string) (*model.Message, error)
}

func sourceImageInputs(ctx context.Context, repo interface{}, convID string, replyTo *string, dir string) ([]imageInput, error) {
	if replyTo == nil || *replyTo == "" {
		return nil, nil
	}
	reader, ok := repo.(imageMessageReader)
	if !ok {
		return nil, fmt.Errorf("image source reader unavailable")
	}
	msg, err := reader.GetByID(ctx, *replyTo)
	if err != nil {
		return nil, fmt.Errorf("read image source: %w", err)
	}
	if msg == nil {
		return nil, fmt.Errorf("image source message unavailable")
	}
	if msg.DeletedAt != nil {
		return nil, fmt.Errorf("image source message deleted")
	}
	if msg.ConversationID != convID {
		return nil, fmt.Errorf("image source conversation mismatch")
	}
	return buildImageInputs(ctx, msg.Attachments, dir)
}

func requireImageCapability(hub interface{}, machineID string, images []imageInput) error {
	if len(images) == 0 {
		return nil
	}
	checker, ok := hub.(interface{ SupportsCapability(string, string) bool })
	if !ok || !checker.SupportsCapability(machineID, "image_inputs_v1") {
		return fmt.Errorf("图片输入需要新版 Di Agent daemon，请重新运行连接命令升级后重试")
	}
	return nil
}

// buildImageInputs 只读取已落库上传文件的原始内容，不访问附件 URL。
func buildImageInputs(ctx context.Context, attachments []model.MessageAttachment, dir string) ([]imageInput, error) {
	var out []imageInput
	remaining := int64(4 << 20)
	for _, a := range attachments {
		if !strings.HasPrefix(a.MimeType, "image/") {
			continue
		}
		if len(out) >= 4 {
			return nil, fmt.Errorf("每条消息最多传递 4 张图片给 Agent")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if dir == "" || !regexp.MustCompile(`^uploads/originals/[a-f0-9]{64}\.(png|jpg|jpeg|gif|webp)$`).MatchString(a.FilePath) {
			return nil, fmt.Errorf("invalid image storage path")
		}
		root, err := filepath.EvalSymlinks(dir)
		if err != nil {
			return nil, fmt.Errorf("image upload directory: %w", err)
		}
		file, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(a.FilePath, "uploads/"))))
		if err != nil {
			return nil, fmt.Errorf("read uploaded image: %w", err)
		}
		rel, err := filepath.Rel(root, file)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("invalid image storage path")
		}
		f, err := os.Open(file)
		if err != nil {
			return nil, fmt.Errorf("open uploaded image: %w", err)
		}
		stat, err := f.Stat()
		if err != nil || !stat.Mode().IsRegular() {
			f.Close()
			return nil, fmt.Errorf("invalid image file")
		}
		data, err := io.ReadAll(io.LimitReader(f, remaining+1))
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("read image: %w", err)
		}
		if int64(len(data)) > remaining {
			return nil, fmt.Errorf("发给 Agent 的图片总大小不能超过 4 MiB，请压缩后重试")
		}
		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" && mime != "image/webp" {
			return nil, fmt.Errorf("Agent 图片仅支持 PNG/JPEG/GIF/WebP")
		}
		remaining -= int64(len(data))
		out = append(out, imageInput{MimeType: mime, Data: base64.StdEncoding.EncodeToString(data)})
	}
	return out, nil
}
