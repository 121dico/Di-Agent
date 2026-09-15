package model

// StationScoreEvidence 仅由管理员接口返回；身份案例不进入公共报表缓存。
type StationScoreEvidence struct {
	StationID      string             `json:"station_id"`
	Start          string             `json:"start"`
	End            string             `json:"end"`
	Level          string             `json:"level"`
	MinDays        int                `json:"min_days"`
	CandidateCount int                `json:"candidate_count"`
	Limit          int                `json:"limit"`
	FetchedAt      string             `json:"fetched_at"`
	Cases          []StationScoreCase `json:"cases"`
}

type StationScoreCase struct {
	DUID                  string                 `json:"duid"`
	ConsumptionDays       int                    `json:"consumption_days"`
	Orders                int64                  `json:"orders"`
	FirstDate             string                 `json:"first_date"`
	LastDate              string                 `json:"last_date"`
	LabelDate             string                 `json:"label_date"`
	Level                 string                 `json:"level"`
	Status                string                 `json:"status"`
	Reason                string                 `json:"reason"`
	Fields                map[string]interface{} `json:"fields"`
	ObservedContributions map[string]*float64    `json:"observed_contributions"`
}
