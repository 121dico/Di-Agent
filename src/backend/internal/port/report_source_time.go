package port

import (
	"context"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// ReportSourceTimeStore 持久化源级元数据，不依赖报表实例。
type ReportSourceTimeStore interface {
	GetSourceTimeCoverage(context.Context, string) (*model.ReportSourceTimeCoverage, error)
	SaveSourceTimeCoverage(context.Context, *model.ReportSourceTimeCoverage) error
}
