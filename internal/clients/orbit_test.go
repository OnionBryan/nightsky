package clients

import (
	"context"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "noaa21_orbit/api/proto/orbit/v1"
)

// minimalScience implements ListSatellites only for reconnect tests.
type minimalScience struct {
	pb.UnimplementedOrbitScienceServer
	calls int
}

func (m *minimalScience) ListSatellites(ctx context.Context, _ *pb.ListSatellitesRequest) (*pb.ListSatellitesResponse, error) {
	m.calls++
	return &pb.ListSatellitesResponse{DefaultSatellite: "noaa21"}, nil
}

func startScience(t *testing.T, srv pb.OrbitScienceServer) (addr string, stop func()) {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	gs := grpc.NewServer()
	pb.RegisterOrbitScienceServer(gs, srv)
	go gs.Serve(lis)
	return lis.Addr().String(), func() {
		gs.Stop()
		_ = lis.Close()
	}
}

func TestOrbitClientReconnectAfterScienceRestart(t *testing.T) {
	science := &minimalScience{}
	addr, stop1 := startScience(t, science)

	client, err := NewOrbitClient(addr)
	if err != nil {
		t.Fatalf("NewOrbitClient: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	res, err := client.ListSatellites(ctx, &pb.ListSatellitesRequest{})
	if err != nil {
		t.Fatalf("first ListSatellites: %v", err)
	}
	if res.DefaultSatellite != "noaa21" {
		t.Fatalf("unexpected default: %q", res.DefaultSatellite)
	}

	// Kill science worker (same as process restart for the client)
	stop1()
	time.Sleep(50 * time.Millisecond)

	// First call after kill should fail (or succeed after reconnect if nothing
	// is listening — expect error)
	ctx2, cancel2 := context.WithTimeout(context.Background(), 500*time.Millisecond)
	_, err = client.ListSatellites(ctx2, &pb.ListSatellitesRequest{})
	cancel2()
	if err == nil {
		t.Fatal("expected error while science is down")
	}
	if st, ok := status.FromError(err); ok && st.Code() != codes.Unavailable && st.Code() != codes.DeadlineExceeded {
		// Accept various transport errors
		t.Logf("down-state code=%v msg=%v", st.Code(), st.Message())
	}

	// Restart science on the same address (OS may rebind if we re-listen)
	// Use the same port from addr
	science2 := &minimalScience{}
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		// Port may still be in TIME_WAIT; try a new port and re-point client
		// by constructing a fresh client only if needed — reconnect must work
		// when the same address comes back.
		t.Fatalf("rebind %s: %v", addr, err)
	}
	gs := grpc.NewServer()
	pb.RegisterOrbitScienceServer(gs, science2)
	go gs.Serve(lis)
	defer gs.Stop()

	// Wait until science answers through the edge client without recreating OrbitClient
	var lastErr error
	ok := false
	for i := 0; i < 40; i++ {
		ctx3, cancel3 := context.WithTimeout(context.Background(), 500*time.Millisecond)
		res, err := client.ListSatellites(ctx3, &pb.ListSatellitesRequest{})
		cancel3()
		if err == nil && res != nil && res.DefaultSatellite == "noaa21" {
			ok = true
			break
		}
		lastErr = err
		time.Sleep(50 * time.Millisecond)
	}
	if !ok {
		t.Fatalf("reconnect failed after science restart: last err=%v", lastErr)
	}
	if science2.calls < 1 {
		t.Fatalf("expected restarted science to receive calls, got %d", science2.calls)
	}
}
