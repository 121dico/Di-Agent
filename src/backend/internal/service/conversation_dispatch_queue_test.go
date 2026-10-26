package service

import (
	"testing"
	"time"
)

func TestConversationDispatchQueueSteersWhileRunningAndKeepsFallbackFIFO(t *testing.T) {
	var queue ConversationDispatchQueue
	started := make(chan string, 4)
	release := make(chan struct{})
	queue.Submit("conversation/agent", nil, func() { started <- "first"; <-release })
	if got := <-started; got != "first" {
		t.Fatal(got)
	}
	steered := make(chan struct{})
	queue.Submit("conversation/agent", func() bool { close(steered); return true }, func() { t.Error("accepted steer ran twice") })
	select {
	case <-steered:
	case <-time.After(time.Second):
		t.Fatal("steer blocked behind active task")
	}
	queue.Submit("conversation/agent", nil, func() { started <- "second" })
	queue.Submit("conversation/agent", nil, func() { started <- "third" })
	queue.Submit("conversation/other", nil, func() { started <- "other" })
	if got := <-started; got != "other" {
		t.Fatalf("other agent blocked: %s", got)
	}
	close(release)
	for _, want := range []string{"second", "third"} {
		select {
		case got := <-started:
			if got != want {
				t.Fatalf("got %s want %s", got, want)
			}
		case <-time.After(time.Second):
			t.Fatal("queued dispatch lost")
		}
	}
}

func TestConversationDispatchQueueDoesNotSteerPastQueuedAttachment(t *testing.T) {
	var queue ConversationDispatchQueue
	waiting := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	queue.SubmitWhenReady("conv/agent", nil, func(ready func()) { close(waiting); <-release; ready() }, nil)
	<-waiting
	queued := make(chan struct{})
	queue.Submit("conv/agent", func() bool { t.Error("later text overtook queued attachment"); return true }, func() { close(done) }, func() { close(queued) })
	<-queued
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("queued follow-up lost")
	}
}

func TestConversationDispatchQueueMultiTargetReservesEachTarget(t *testing.T) {
	var queue ConversationDispatchQueue
	started := make(chan string, 5)
	release := make(chan struct{})
	queue.Submit("A", nil, func() { started <- "first"; <-release })
	<-started
	queue.SubmitMany([]string{"A", "B", "A"}, func() { started <- "both" }, nil)
	queue.Submit("B", nil, func() { started <- "B" })
	close(release)
	for _, want := range []string{"both", "B"} {
		select {
		case got := <-started:
			if got != want {
				t.Fatalf("got %s want %s", got, want)
			}
		case <-time.After(time.Second):
			t.Fatal("multi target deadlocked")
		}
	}
}
