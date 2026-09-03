package report

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type signerFake struct{}

func (signerFake) Headers(context.Context, model.ReportDataSource, time.Time, []byte) (map[string]string, error) {
	return map[string]string{"x-app-key": "test-app", "sign": "test-sign", "x-date": "2026-08-25T00:00:00Z"}, nil
}

func TestHTTPConnectorNormalizesDataServiceResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/dataservice/gateway/v1/api/price_sensitive" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resultCode":"0","returnMsg":"success","data":{"data":[{"users":"42"}],"paginationDTO":{"total":10591,"pageSize":20,"pageCount":530,"page":2},"queryId":"query-1","maxAccPartition":{"dt":"2026-08-24"}}}`))
	}))
	defer server.Close()

	connector := NewHTTPConnector(server.Client(), signerFake{})
	result, err := connector.Query(context.Background(), model.ReportDataSource{Endpoint: server.URL, APIName: "price_sensitive"}, []byte(`{"fieldList":[]}`))
	if err != nil {
		t.Fatalf("Query returned error: %v", err)
	}
	if result.Partition != "2026-08-24" || result.QueryID != "query-1" || result.Rows[0]["users"] != "42" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Pagination.Total != 10591 || result.Pagination.Page != 2 || result.Pagination.PageSize != 20 || result.Pagination.PageCount != 530 {
		t.Fatalf("unexpected pagination: %#v", result.Pagination)
	}
}

func TestEnvSignerGeneratesDataServiceHMACSignature(t *testing.T) {
	t.Setenv("REPORT_TEST_APP_KEY", "test-app")
	t.Setenv("REPORT_TEST_APP_SECRET", "test-secret")

	headers, err := (EnvSigner{}).Headers(context.Background(), model.ReportDataSource{
		Endpoint:     "http://data.example:8000",
		APIName:      "price_sensitive",
		AppKeyEnv:    "REPORT_TEST_APP_KEY",
		AppSecretEnv: "REPORT_TEST_APP_SECRET",
	}, time.Date(2026, time.August, 28, 10, 2, 11, 0, time.UTC), nil)
	if err != nil {
		t.Fatalf("Headers returned error: %v", err)
	}
	if headers["x-date"] != "2026-08-28T10:02:11Z" {
		t.Fatalf("unexpected x-date: %q", headers["x-date"])
	}
	if headers["x-app-key"] != "test-app" {
		t.Fatalf("unexpected x-app-key: %q", headers["x-app-key"])
	}
	if headers["sign"] != "jekdt/ch72U5oCG4+SrBW4TcpVkivMF8T0f+iD2KHvI=" {
		t.Fatalf("unexpected sign: %q", headers["sign"])
	}
}

func TestEnvSignerFallsBackToConfiguredStaticSignatureWhenSecretIsUnavailable(t *testing.T) {
	t.Setenv("REPORT_TEST_APP_KEY", "test-app")
	t.Setenv("REPORT_TEST_STATIC_SIGN", "test-sign")
	t.Setenv("REPORT_TEST_STATIC_DATE", "2026-08-25T16:35:26Z")

	headers, err := (EnvSigner{}).Headers(context.Background(), model.ReportDataSource{
		Endpoint:     "http://data.example:8000",
		APIName:      "price_sensitive",
		AppKeyEnv:    "REPORT_TEST_APP_KEY",
		AppSecretEnv: "REPORT_TEST_MISSING_SECRET",
		SignatureEnv: "REPORT_TEST_STATIC_SIGN",
		XDateEnv:     "REPORT_TEST_STATIC_DATE",
	}, time.Date(2026, time.August, 28, 10, 2, 11, 0, time.UTC), nil)
	if err != nil {
		t.Fatalf("Headers returned error: %v", err)
	}
	if headers["sign"] != "test-sign" || headers["x-date"] != "2026-08-25T16:35:26Z" {
		t.Fatalf("expected static replay credentials, got %#v", headers)
	}
}
