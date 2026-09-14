package model

type StationPeopleResult struct {
	Start             string                             `json:"start"`
	End               string                             `json:"end"`
	HistoryStart      string                             `json:"history_start"`
	StationID         string                             `json:"station_id"`
	FetchedAt         string                             `json:"fetched_at"`
	Users             int64                              `json:"users"`
	RepeatUsers       int64                              `json:"repeat_users"`
	MultiDayUsers     int64                              `json:"multi_day_users"`
	CrossStationUsers int64                              `json:"cross_station_users"`
	Days              []StationPeopleDay                 `json:"days"`
	Levels            map[string]*StationPeopleFrequency `json:"levels"`
}

type StationPeopleFrequency struct {
	Users        int64 `json:"users"`
	Once         int64 `json:"once"`
	Twice        int64 `json:"twice"`
	ThreePlus    int64 `json:"three_plus"`
	MultiDay     int64 `json:"multi_day"`
	CrossStation int64 `json:"cross_station"`
}

type StationPeopleDay struct {
	PreviousAvailable bool                             `json:"previous_available"`
	WeekDaysAvailable int                              `json:"week_days_available"`
	Date              string                           `json:"dt"`
	Users             int64                            `json:"users"`
	New               int64                            `json:"new"`
	Returning         int64                            `json:"returning"`
	Previous          int64                            `json:"previous"`
	PreviousWeek      int64                            `json:"previous_week"`
	Levels            map[string]*StationPeopleOverlap `json:"levels"`
}

type StationPeopleOverlap struct {
	Users         int64 `json:"users"`
	New           int64 `json:"new"`
	Returning     int64 `json:"returning"`
	PreviousWeek  int64 `json:"previous_week"`
	SameLevelWeek int64 `json:"same_level_week"`
}
