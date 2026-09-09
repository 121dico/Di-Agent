package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
	_ "golang.org/x/image/webp"
)

// PersistReturnedImages 将已授权任务返回的有界图片解码重编码后保存；不信任路径、扩展名或 URL。
// 重编码丢弃非图像尾随数据和元数据，数据库只保存服务器 URL，不保存 base64。
func (s *UploadService) PersistReturnedImages(ctx context.Context, artifacts []ws.ArtifactResult) ([]ws.ArtifactResult, error) {
	out := make([]ws.ArtifactResult, 0, len(artifacts))
	count, total := 0, 0
	for _, a := range artifacts {
		if a.Type != "image" {
			out = append(out, a)
			continue
		}
		count++
		if count > 4 {
			return nil, fmt.Errorf("返回图片超过 4 张")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		prefix, data, ok := strings.Cut(a.Content, ",")
		if !ok || (prefix != "data:image/png;base64" && prefix != "data:image/jpeg;base64" && prefix != "data:image/gif;base64" && prefix != "data:image/webp;base64") || len(data) > ((4<<20)+2)/3*4 {
			return nil, fmt.Errorf("返回图片编码无效或过大")
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(data)
		if err != nil {
			return nil, fmt.Errorf("返回图片 base64 无效")
		}
		total += len(raw)
		if total > 4<<20 {
			return nil, fmt.Errorf("返回图片总大小超过 4 MiB")
		}
		cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 16_000_000 {
			return nil, fmt.Errorf("返回图片格式或像素尺寸无效")
		}
		img, _, err := image.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, fmt.Errorf("返回图片内容无效")
		}
		var encoded bytes.Buffer
		if err = png.Encode(&encoded, img); err != nil {
			return nil, fmt.Errorf("编码返回图片: %w", err)
		}
		if encoded.Len() > 4<<20 {
			return nil, fmt.Errorf("返回图片编码后超过 4 MiB")
		}
		sum := sha256.Sum256(encoded.Bytes())
		name := hex.EncodeToString(sum[:]) + ".png"
		dir := filepath.Join(s.cfg.Dir, "originals")
		if err = os.MkdirAll(dir, 0700); err != nil {
			return nil, fmt.Errorf("创建图片目录: %w", err)
		}
		target := filepath.Join(dir, name)
		f, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			_, writeErr := f.Write(encoded.Bytes())
			closeErr := f.Close()
			if writeErr != nil {
				return nil, fmt.Errorf("保存返回图片: %w", writeErr)
			}
			if closeErr != nil {
				return nil, fmt.Errorf("关闭返回图片: %w", closeErr)
			}
		} else if !os.IsExist(err) {
			return nil, fmt.Errorf("创建返回图片: %w", err)
		}
		a.URL = s.urlBuilder.UploadURL("uploads/originals/" + name)
		a.Content = ""
		a.Filename = strings.TrimSuffix(filepath.Base(a.Filename), filepath.Ext(a.Filename)) + ".png"
		out = append(out, a)
	}
	return out, nil
}
