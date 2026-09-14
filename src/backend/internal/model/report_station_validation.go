package model

// StationValidationResult 只保存按日聚合，不向报表用户暴露订单或 DUID 明细。
type StationValidationResult struct {
	SourceID       string                 `json:"source_id"`
	SourceName     string                 `json:"source_name"`
	FetchedAt      string                 `json:"fetched_at"`
	AvailableDates []string               `json:"available_dates"`
	Rows           []StationValidationDay `json:"rows"`
	People         *StationPeopleResult   `json:"people,omitempty"`
}

type StationValidationDay struct {
	Date        string           `json:"dt"`
	StationID   string           `json:"station_id"`
	StationName string           `json:"station_name"`
	Users       int64            `json:"users"`
	Levels      map[string]int64 `json:"levels"`
}
