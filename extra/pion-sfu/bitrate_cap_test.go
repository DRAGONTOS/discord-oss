package main

import (
	"testing"
	"time"
)

func TestClampBitrateCap(t *testing.T) {
	for _, test := range []struct {
		requested int
		want      int
	}{
		{0, 0},
		{-1, 0},
		{50_000, rembFloor},
		{2_000_000, 2_000_000},
		{20_000_000, rembCeiling},
	} {
		if got := clampBitrateCap(test.requested); got != test.want {
			t.Fatalf("clampBitrateCap(%d) = %d, want %d", test.requested, got, test.want)
		}
	}
}

func subscriberWithRemb(remb float32) *Peer {
	return &Peer{id: "sub", remb: remb, rembAt: time.Now(), videoLoss: make(map[uint32]lossReport)}
}

func TestAdjustBitrateCapRespectsRequestedCeiling(t *testing.T) {
	for _, test := range []struct {
		name        string
		requested   int
		existingCap int
		subscribers []*Peer
		want        int
	}{
		{"no request uses default ceiling", 0, 0, nil, rembCeiling},
		{"below request wins over remb", 2_000_000, 0, []*Peer{subscriberWithRemb(5_000_000)}, 2_000_000},
		{"above ceiling is clamped", 20_000_000, 0, nil, rembCeiling},
		{"below floor is clamped", 50_000, 0, nil, rembFloor},
		{"lower remb still wins", 5_000_000, 0, []*Peer{subscriberWithRemb(800_000)}, 800_000},
		{"existing cap is reduced", 2_000_000, 9_000_000, nil, 2_000_000},
	} {
		t.Run(test.name, func(t *testing.T) {
			pt := &PublishedTrack{ssrc: 42, requestedBitrateCap: test.requested, bitrateCap: test.existingCap}
			limit := pt.adjustBitrateCap(test.subscribers)
			if limit != test.want {
				t.Fatalf("limit = %d, want %d", limit, test.want)
			}
			if test.requested > 0 {
				ceiling := clampBitrateCap(test.requested)
				if limit > ceiling {
					t.Fatalf("limit %d exceeds requested ceiling %d", limit, ceiling)
				}
				if pt.bitrateCap > ceiling {
					t.Fatalf("bitrateCap %d exceeds requested ceiling %d", pt.bitrateCap, ceiling)
				}
			}
		})
	}
}
