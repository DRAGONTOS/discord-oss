package main

import (
	"fmt"
	"slices"
	"sync"
)

type Sfu struct {
	mu            sync.RWMutex
	peers         map[string]*Peer
	subscribers   map[string][]*Peer
	subscriptions map[*Peer]map[string]struct{}
	tracksBySSRC  map[uint32]*PublishedTrack
}

func NewSfu() *Sfu {
	return &Sfu{
		peers:         make(map[string]*Peer),
		subscribers:   make(map[string][]*Peer),
		subscriptions: make(map[*Peer]map[string]struct{}),
		tracksBySSRC:  make(map[uint32]*PublishedTrack),
	}
}

func (r *Sfu) indexTrackLocked(pt *PublishedTrack) {
	if pt == nil {
		return
	}
	r.tracksBySSRC[uint32(pt.ssrc)] = pt
	if pt.kind == "video" {
		r.tracksBySSRC[uint32(pt.ssrc)+1] = pt
	}
}

func (r *Sfu) forgetTrackLocked(pt *PublishedTrack) {
	if pt == nil {
		return
	}
	if r.tracksBySSRC[uint32(pt.ssrc)] == pt {
		delete(r.tracksBySSRC, uint32(pt.ssrc))
	}
	if pt.kind == "video" && r.tracksBySSRC[uint32(pt.ssrc)+1] == pt {
		delete(r.tracksBySSRC, uint32(pt.ssrc)+1)
	}
}

func (r *Sfu) IndexTrack(pt *PublishedTrack) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.indexTrackLocked(pt)
}

func (r *Sfu) ForgetTrack(pt *PublishedTrack) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.forgetTrackLocked(pt)
}

func (r *Sfu) SwapTrack(previous, next *PublishedTrack) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.forgetTrackLocked(previous)
	r.indexTrackLocked(next)
}

func (r *Sfu) isSubscribedLocked(sub *Peer, key string) bool {
	_, ok := r.subscriptions[sub][key]
	return ok
}

func (r *Sfu) SubscribedTrackBySSRC(sub *Peer, ssrc uint32) *PublishedTrack {
	r.mu.RLock()
	pt := r.tracksBySSRC[ssrc]
	stale := pt != nil && pt.isClosed()
	if pt == nil || stale || pt.publisher == sub || !r.isSubscribedLocked(sub, pt.key) {
		r.mu.RUnlock()
		if stale {
			r.ForgetTrack(pt)
		}
		return nil
	}
	r.mu.RUnlock()
	return pt
}

func (r *Sfu) SubscribersOf(publisherID string) []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	seen := make(map[*Peer]struct{})
	var subs []*Peer
	for _, trackType := range []string{"audio", "video"} {
		for _, sub := range r.subscribers[subscriptionKey(publisherID, trackType)] {
			if _, ok := seen[sub]; !ok {
				seen[sub] = struct{}{}
				subs = append(subs, sub)
			}
		}
	}
	return subs
}

func subscriptionKey(publisherID, trackType string) string {
	return publisherID + "_" + trackType
}

func (r *Sfu) AddPeer(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.peers[p.id] = p
}

func (r *Sfu) RemovePeer(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p := r.peers[id]
	if p == nil {
		return
	}
	delete(r.peers, id)
	for key := range r.subscriptions[p] {
		r.removeSubscriber(key, p)
	}
	delete(r.subscriptions, p)
	for _, trackType := range []string{"audio", "video"} {
		key := subscriptionKey(id, trackType)
		for _, sub := range r.subscribers[key] {
			delete(r.subscriptions[sub], key)
		}
		delete(r.subscribers, key)
	}
}

func (r *Sfu) GetPeer(id string) *Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.peers[id]
}

func (r *Sfu) PeerSnapshot() []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	peers := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	return peers
}

func (r *Sfu) Subscribe(sub, publisher *Peer, trackType string) error {
	key := subscriptionKey(publisher.id, trackType)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.peers[sub.id] != sub {
		return fmt.Errorf("client %s left", sub.id)
	}
	if r.peers[publisher.id] != publisher {
		return fmt.Errorf("publisher %s left", publisher.id)
	}
	if _, ok := r.subscriptions[sub][key]; ok {
		return fmt.Errorf("already subscribed to %s", key)
	}
	if r.subscriptions[sub] == nil {
		r.subscriptions[sub] = make(map[string]struct{})
	}
	r.subscriptions[sub][key] = struct{}{}
	current := r.subscribers[key]
	next := make([]*Peer, len(current), len(current)+1)
	copy(next, current)
	r.subscribers[key] = append(next, sub)
	return nil
}

func (r *Sfu) Unsubscribe(sub *Peer, key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.subscriptions[sub][key]; !ok {
		return fmt.Errorf("not subscribed to %s", key)
	}
	delete(r.subscriptions[sub], key)
	r.removeSubscriber(key, sub)
	return nil
}

func (r *Sfu) removeSubscriber(key string, sub *Peer) {
	current := r.subscribers[key]
	index := slices.Index(current, sub)
	if index < 0 {
		return
	}
	if len(current) == 1 {
		delete(r.subscribers, key)
		return
	}
	next := make([]*Peer, 0, len(current)-1)
	next = append(next, current[:index]...)
	r.subscribers[key] = append(next, current[index+1:]...)
}

func (r *Sfu) Subscribers(key string) []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.subscribers[key]
}

func (r *Sfu) IsSubscribed(sub *Peer, key string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.isSubscribedLocked(sub, key)
}
