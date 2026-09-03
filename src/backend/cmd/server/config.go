package main

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

// Config 应用配置结构
type Config struct {
	Server struct {
		Port        int    `koanf:"port"`
		ExternalURL string `koanf:"external_url"` // 局域网/公网可达地址；为空时仅生成本机 127.0.0.1 连接命令
		TLSPort     int    `koanf:"tls_port"`     // HTTPS 监听端口；配置了 tls_cert/tls_key 时启用
		TLSCert     string `koanf:"tls_cert"`     // 证书 PEM 路径（自签名即可，用于解锁浏览器安全上下文 API）
		TLSKey      string `koanf:"tls_key"`      // 私钥 PEM 路径
	} `koanf:"server"`
	Database struct {
		Host     string `koanf:"host"`
		Port     int    `koanf:"port"`
		User     string `koanf:"user"`
		Password string `koanf:"password"`
		DBName   string `koanf:"dbname"`
		SSLMode  string `koanf:"sslmode"`
	} `koanf:"database"`
	JWT struct {
		Secret      string `koanf:"secret"`
		ExpiryHours int    `koanf:"expiry_hours"`
	} `koanf:"jwt"`
	Daemon struct {
		Token string `koanf:"token"`
	} `koanf:"daemon"`
	CORS struct {
		AllowedOrigins []string `koanf:"allowed_origins"`
	} `koanf:"cors"`
	Redis struct {
		Host     string `koanf:"host"`
		Port     int    `koanf:"port"`
		Password string `koanf:"password"`
		DB       int    `koanf:"db"`
	} `koanf:"redis"`
	Upload struct {
		Dir           string `koanf:"dir"`
		MaxImageMB    int    `koanf:"max_image_mb"`
		MaxPDFMB      int    `koanf:"max_pdf_mb"`
		PublicBaseURL string `koanf:"public_base_url"`
	} `koanf:"upload"`
	Log struct {
		Level string `koanf:"level"`
	} `koanf:"log"`
	RateLimit struct {
		RPS   float64 `koanf:"rps"`
		Burst int     `koanf:"burst"`
	} `koanf:"rate_limit"`
	GitHub struct {
		Token     string `koanf:"token"`      // PAT（classic，repo 权限）；建议用环境变量 GITHUB_TOKEN 注入
		Owner     string `koanf:"owner"`      // 仓库归属账号，如 Shallow-W；可用 GITHUB_PAGES_OWNER 覆盖
		PagesRepo string `koanf:"pages_repo"` // 专用公开仓库名，如 di-agent-sites；可用 GITHUB_PAGES_REPO 覆盖
	} `koanf:"github"`
	RAG struct {
		Enabled             bool    `koanf:"enabled"`
		Provider            string  `koanf:"provider"`
		OllamaURL           string  `koanf:"ollama_url"`
		Model               string  `koanf:"model"`
		Dimensions          int     `koanf:"dimensions"`
		SemanticThreshold   float64 `koanf:"semantic_threshold"`
		TargetChunkChars    int     `koanf:"target_chunk_chars"`
		MaxChunkChars       int     `koanf:"max_chunk_chars"`
		ChunkOverlapChars   int     `koanf:"chunk_overlap_chars"`
		TopK                int     `koanf:"top_k"`
		CandidateTopN       int     `koanf:"candidate_top_n"`
		BatchSize           int     `koanf:"batch_size"`
		RequestTimeoutSecs  int     `koanf:"request_timeout_seconds"`
		RerankerEnabled     bool    `koanf:"reranker_enabled"`
		RerankerURL         string  `koanf:"reranker_url"`
		RerankerModel       string  `koanf:"reranker_model"`
		RerankerTimeoutSecs int     `koanf:"reranker_timeout_seconds"`
	} `koanf:"rag"`
}

// loadConfig 从 YAML 文件加载配置
func loadConfig(path string) (*Config, error) {
	if envPath := readDiAgentEnv("CONFIG"); envPath != "" {
		path = envPath
	}
	// Local credentials live beside config.yaml in a git-ignored file. Values
	// already supplied by the process environment always take precedence.
	if err := loadLocalEnvironment(filepath.Join(filepath.Dir(path), ".env.local")); err != nil {
		return nil, fmt.Errorf("load local environment: %w", err)
	}

	k := koanf.New(".")
	if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
		return nil, fmt.Errorf("load config file: %w", err)
	}

	var cfg Config
	if err := k.Unmarshal("", &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	cfg.applyRAGDefaults(k.Exists("rag.enabled"), k.Exists("rag.reranker_enabled"))
	cfg.applyTLSDefaults()
	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return &cfg, nil
}

func loadLocalEnvironment(path string) error {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || !validEnvironmentKey(key) {
			return fmt.Errorf("invalid environment assignment for %q", key)
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func validEnvironmentKey(key string) bool {
	if key == "" || !((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= 'a' && key[0] <= 'z') || key[0] == '_') {
		return false
	}
	for i := 1; i < len(key); i++ {
		char := key[i]
		if !((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_') {
			return false
		}
	}
	return true
}

// applyTLSDefaults 补全 TLS 默认值：只配了证书没配端口时默认 8443。
func (c *Config) applyTLSDefaults() {
	if c.Server.TLSCert != "" && c.Server.TLSKey != "" && c.Server.TLSPort == 0 {
		c.Server.TLSPort = 8443
	}
}

// TLSEnabled 返回是否启用 HTTPS 侧监听（证书与私钥文件均存在）。
func (c *Config) TLSEnabled() bool {
	if c.Server.TLSCert == "" || c.Server.TLSKey == "" || c.Server.TLSPort <= 0 {
		return false
	}
	if _, err := os.Stat(c.Server.TLSCert); err != nil {
		return false
	}
	if _, err := os.Stat(c.Server.TLSKey); err != nil {
		return false
	}
	return true
}

func (c *Config) applyRAGDefaults(hasEnabled bool, hasRerankerEnabled ...bool) {
	if !hasEnabled {
		c.RAG.Enabled = true
	}
	if c.RAG.Provider == "" {
		c.RAG.Provider = "ollama"
	}
	if c.RAG.OllamaURL == "" {
		c.RAG.OllamaURL = "http://localhost:11434"
	}
	if c.RAG.Model == "" {
		c.RAG.Model = "bge-m3"
	}
	if c.RAG.Dimensions == 0 {
		c.RAG.Dimensions = 1024
	}
	if c.RAG.SemanticThreshold == 0 {
		c.RAG.SemanticThreshold = 0.72
	}
	if c.RAG.TargetChunkChars == 0 {
		c.RAG.TargetChunkChars = 900
	}
	if c.RAG.MaxChunkChars == 0 {
		c.RAG.MaxChunkChars = 1400
	}
	if c.RAG.ChunkOverlapChars == 0 {
		c.RAG.ChunkOverlapChars = 150
	}
	if c.RAG.TopK == 0 {
		c.RAG.TopK = 6
	}
	if c.RAG.CandidateTopN == 0 {
		c.RAG.CandidateTopN = 20
	}
	if c.RAG.BatchSize == 0 {
		c.RAG.BatchSize = 32
	}
	if c.RAG.RequestTimeoutSecs == 0 {
		c.RAG.RequestTimeoutSecs = 60
	}
	rerankerExplicit := len(hasRerankerEnabled) > 0 && hasRerankerEnabled[0]
	if !rerankerExplicit {
		c.RAG.RerankerEnabled = true
	}
	if c.RAG.RerankerURL == "" {
		c.RAG.RerankerURL = "http://localhost:8081"
	}
	if c.RAG.RerankerModel == "" {
		c.RAG.RerankerModel = "BAAI/bge-reranker-v2-m3"
	}
	if c.RAG.RerankerTimeoutSecs == 0 {
		c.RAG.RerankerTimeoutSecs = 30
	}

	if value, ok := lookupDiAgentEnv("RAG_ENABLED"); ok {
		c.RAG.Enabled = !isFalsy(value)
	}
	c.RAG.OllamaURL = firstNonEmpty(readDiAgentEnv("RAG_OLLAMA_URL"), c.RAG.OllamaURL)
	c.RAG.Model = firstNonEmpty(readDiAgentEnv("RAG_MODEL"), c.RAG.Model)
	applyPositiveIntEnv("RAG_TOP_K", &c.RAG.TopK)
	applyPositiveIntEnv("RAG_CANDIDATE_TOP_N", &c.RAG.CandidateTopN)
	applyPositiveIntEnv("RAG_BATCH_SIZE", &c.RAG.BatchSize)
	if value, ok := lookupDiAgentEnv("RAG_RERANKER_ENABLED"); ok {
		c.RAG.RerankerEnabled = !isFalsy(value)
	}
	c.RAG.RerankerURL = firstNonEmpty(readDiAgentEnv("RAG_RERANKER_URL"), c.RAG.RerankerURL)
	c.RAG.RerankerModel = firstNonEmpty(readDiAgentEnv("RAG_RERANKER_MODEL"), c.RAG.RerankerModel)
	applyPositiveIntEnv("RAG_RERANKER_TIMEOUT_SECONDS", &c.RAG.RerankerTimeoutSecs)
}

func applyPositiveIntEnv(suffix string, target *int) {
	if value := strings.TrimSpace(readDiAgentEnv(suffix)); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			*target = parsed
		}
	}
}

func (c *Config) validate() error {
	if c.JWT.Secret == "" {
		return fmt.Errorf("jwt.secret is required")
	}
	if c.Server.Port <= 0 {
		return fmt.Errorf("server.port must be positive")
	}
	if c.Database.Host == "" {
		return fmt.Errorf("database.host is required")
	}
	if c.Database.DBName == "" {
		return fmt.Errorf("database.dbname is required")
	}
	if c.RAG.Enabled && c.RAG.Dimensions != 1024 {
		return fmt.Errorf("rag.dimensions must be 1024 for the current pgvector schema")
	}
	if c.RAG.Enabled {
		if !strings.EqualFold(strings.TrimSpace(c.RAG.Provider), "ollama") {
			return fmt.Errorf("rag.provider must be ollama")
		}
		if strings.TrimSpace(c.RAG.OllamaURL) == "" {
			return fmt.Errorf("rag.ollama_url is required")
		}
		if strings.TrimSpace(c.RAG.Model) == "" {
			return fmt.Errorf("rag.model is required")
		}
		if c.RAG.SemanticThreshold <= 0 || c.RAG.SemanticThreshold >= 1 {
			return fmt.Errorf("rag.semantic_threshold must be between 0 and 1")
		}
		if c.RAG.TargetChunkChars <= 0 || c.RAG.MaxChunkChars <= 0 || c.RAG.TargetChunkChars > c.RAG.MaxChunkChars {
			return fmt.Errorf("rag chunk sizes must be positive and target_chunk_chars must not exceed max_chunk_chars")
		}
		if c.RAG.ChunkOverlapChars < 0 || c.RAG.ChunkOverlapChars >= c.RAG.MaxChunkChars {
			return fmt.Errorf("rag.chunk_overlap_chars must be non-negative and smaller than max_chunk_chars")
		}
		if c.RAG.TopK <= 0 || c.RAG.TopK > 50 {
			return fmt.Errorf("rag.top_k must be between 1 and 50")
		}
		if c.RAG.CandidateTopN < c.RAG.TopK || c.RAG.CandidateTopN > 50 {
			return fmt.Errorf("rag.candidate_top_n must be between top_k and 50")
		}
		if c.RAG.BatchSize <= 0 || c.RAG.RequestTimeoutSecs <= 0 {
			return fmt.Errorf("rag.batch_size and rag.request_timeout_seconds must be positive")
		}
		if c.RAG.RerankerEnabled {
			if strings.TrimSpace(c.RAG.RerankerURL) == "" || strings.TrimSpace(c.RAG.RerankerModel) == "" {
				return fmt.Errorf("rag.reranker_url and rag.reranker_model are required when reranker is enabled")
			}
			if c.RAG.RerankerTimeoutSecs <= 0 {
				return fmt.Errorf("rag.reranker_timeout_seconds must be positive")
			}
		}
	}
	return nil
}

// parseLogLevel 将字符串转为 slog.Level
func parseLogLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// firstNonEmpty 返回第一个非空字符串（用于环境变量覆盖配置文件）。
func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// isFalsy 判断环境变量是否表示「关闭」（false/0/no/off，忽略大小写与首尾空白）。
func isFalsy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "no", "off":
		return true
	}
	return false
}
