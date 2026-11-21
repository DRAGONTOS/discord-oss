package main

import (
	"testing"
)

func TestForwardsToSkipsOwnAudioForExternalPublisher(t *testing.T) {
	publisher := &Peer{userID: "owner", external: true}
	track := &PublishedTrack{kind: "audio", publisher: publisher}

	owner := &Peer{userID: "owner"}
	if track.forwardsTo(owner) {
		t.Fatal("external publisher must not receive its own audio")
	}

	viewer := &Peer{userID: "viewer"}
	if !track.forwardsTo(viewer) {
		t.Fatal("other viewers must still receive audio")
	}
}

func TestForwardsToKeepsNativePublisherAudio(t *testing.T) {
	publisher := &Peer{userID: "owner", external: false}
	track := &PublishedTrack{kind: "audio", publisher: publisher}

	owner := &Peer{userID: "owner"}
	if !track.forwardsTo(owner) {
		t.Fatal("native publisher audio forwarding must be unchanged")
	}
}

func TestForwardsToStillHonoursDeaf(t *testing.T) {
	publisher := &Peer{userID: "owner", external: true}
	track := &PublishedTrack{kind: "audio", publisher: publisher}

	deafViewer := &Peer{userID: "viewer"}
	deafViewer.deaf.Store(true)
	if track.forwardsTo(deafViewer) {
		t.Fatal("deaf subscriber must not receive audio")
	}
}
