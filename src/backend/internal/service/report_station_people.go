package service

import (
	"fmt"
	"sort"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// StationPersonObservation 仅在后端内存中比对身份，不保存或返回 DUID 明细。
type StationPersonObservation struct {
	Date, Station, DUID, Level string
	Orders                     int64
}

type stationPersonDay struct {
	level    string
	orders   int64
	stations map[string]bool
}

// BuildStationPeople 基于同一 DUID 的真实消费日求交集，不以人数差推断新增或回访。
func BuildStationPeople(rows []StationPersonObservation, dates []string, station, start, end string) (*model.StationPeopleResult, error) {
	result := &model.StationPeopleResult{Start: start, End: end, StationID: station, Days: []model.StationPeopleDay{}, Levels: map[string]*model.StationPeopleFrequency{}}
	if len(dates) == 0 {
		return result, nil
	}
	result.HistoryStart = dates[0]
	people := map[string]map[string]*stationPersonDay{}
	known := map[string]bool{}
	for _, date := range dates {
		known[date] = true
	}
	seen := map[[3]string]bool{}
	for _, row := range rows {
		if !known[row.Date] || row.DUID == "" || row.DUID == "0" || row.Station == "" || row.Orders <= 0 {
			return nil, fmt.Errorf("%w: 用户日数据无效", ErrReportInvalid)
		}
		if row.Date > end || (station != "ALL" && row.Station != station) {
			continue
		}
		key := [3]string{row.Date, row.Station, row.DUID}
		if seen[key] {
			return nil, fmt.Errorf("%w: 同日同站用户存在多标签或重复分组", ErrReportInvalid)
		}
		seen[key] = true
		if people[row.DUID] == nil {
			people[row.DUID] = map[string]*stationPersonDay{}
		}
		day := people[row.DUID][row.Date]
		if day == nil {
			day = &stationPersonDay{level: row.Level, stations: map[string]bool{}}
			people[row.DUID][row.Date] = day
		}
		if day.level != row.Level {
			return nil, fmt.Errorf("%w: 用户当日跨站标签冲突", ErrReportInvalid)
		}
		day.orders += row.Orders
		day.stations[row.Station] = true
	}
	daily := map[string]*model.StationPeopleDay{}
	for _, date := range dates {
		if date >= start && date <= end {
			daily[date] = &model.StationPeopleDay{Date: date, Levels: map[string]*model.StationPeopleOverlap{}}
			t, _ := time.Parse("2006-01-02", date)
			daily[date].PreviousAvailable = known[t.AddDate(0, 0, -1).Format("2006-01-02")]
			for offset := 1; offset <= 7; offset++ {
				if known[t.AddDate(0, 0, -offset).Format("2006-01-02")] {
					daily[date].WeekDaysAvailable++
				}
			}
		}
	}
	for _, observations := range people {
		ordered := make([]string, 0, len(observations))
		for date := range observations {
			ordered = append(ordered, date)
		}
		sort.Strings(ordered)
		var orders int64
		var days int
		latest := ""
		stations := map[string]bool{}
		for index, date := range ordered {
			if date < start {
				continue
			}
			observation, day := observations[date], daily[date]
			orders += observation.orders
			days++
			latest = observation.level
			for id := range observation.stations {
				stations[id] = true
			}
			day.Users++
			if day.Levels[observation.level] == nil {
				day.Levels[observation.level] = &model.StationPeopleOverlap{}
			}
			band := day.Levels[observation.level]
			band.Users++
			if index == 0 {
				day.New++
				band.New++
			} else {
				day.Returning++
				band.Returning++
			}
			t, _ := time.Parse("2006-01-02", date)
			if observations[t.AddDate(0, 0, -1).Format("2006-01-02")] != nil {
				day.Previous++
			}
			week, same := false, false
			for offset := 1; offset <= 7; offset++ {
				old := observations[t.AddDate(0, 0, -offset).Format("2006-01-02")]
				if old != nil {
					week = true
					if old.level == observation.level {
						same = true
					}
				}
			}
			if week {
				day.PreviousWeek++
				band.PreviousWeek++
			}
			if same {
				band.SameLevelWeek++
			}
		}
		if days == 0 {
			continue
		}
		result.Users++
		if result.Levels[latest] == nil {
			result.Levels[latest] = &model.StationPeopleFrequency{}
		}
		band := result.Levels[latest]
		band.Users++
		switch orders {
		case 1:
			band.Once++
		case 2:
			band.Twice++
		default:
			band.ThreePlus++
		}
		if orders > 1 {
			result.RepeatUsers++
		}
		if days > 1 {
			result.MultiDayUsers++
			band.MultiDay++
		}
		if len(stations) > 1 {
			result.CrossStationUsers++
			band.CrossStation++
		}
	}
	for _, date := range dates {
		if day := daily[date]; day != nil {
			result.Days = append(result.Days, *day)
		}
	}
	return result, nil
}
