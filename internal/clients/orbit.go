// Package clients provides a reconnecting gRPC client for the orbit science worker.
package clients

import (
	"context"
	"log"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"

	pb "noaa21_orbit/api/proto/orbit/v1"
)

// OrbitClient wraps OrbitScienceClient with dial + reconnect on transport failure.
type OrbitClient struct {
	addr string

	mu     sync.Mutex
	conn   *grpc.ClientConn
	client pb.OrbitScienceClient
}

// NewOrbitClient dials addr and returns a reconnect-capable client.
func NewOrbitClient(addr string) (*OrbitClient, error) {
	c := &OrbitClient{addr: addr}
	if err := c.dial(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *OrbitClient) dial() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dialLocked()
}

func (c *OrbitClient) dialLocked() error {
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
		c.client = nil
	}
	conn, err := grpc.NewClient(
		c.addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return err
	}
	c.conn = conn
	c.client = pb.NewOrbitScienceClient(conn)
	return nil
}

// Close closes the underlying connection.
func (c *OrbitClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil
	}
	err := c.conn.Close()
	c.conn = nil
	c.client = nil
	return err
}

func (c *OrbitClient) getClient() pb.OrbitScienceClient {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.client
}

func isTransient(err error) bool {
	if err == nil {
		return false
	}
	st, ok := status.FromError(err)
	if !ok {
		return true
	}
	switch st.Code() {
	case codes.Unavailable, codes.DeadlineExceeded, codes.Canceled,
		codes.ResourceExhausted, codes.Aborted:
		return true
	default:
		return false
	}
}

// Invoke runs fn with the live client. On transient failure it re-dials once and retries.
func (c *OrbitClient) Invoke(ctx context.Context, fn func(context.Context, pb.OrbitScienceClient) error) error {
	client := c.getClient()
	if client == nil {
		if err := c.dial(); err != nil {
			return err
		}
		client = c.getClient()
	}

	err := fn(ctx, client)
	if err == nil || !isTransient(err) {
		return err
	}

	log.Printf("orbit gRPC transient error (%v); reconnecting to %s", err, c.addr)
	if dialErr := c.dial(); dialErr != nil {
		return err // return original RPC error
	}

	// Brief pause so a just-restarted science worker can finish bind
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(50 * time.Millisecond):
	}

	client = c.getClient()
	if client == nil {
		return err
	}
	return fn(ctx, client)
}

// --- Convenience wrappers (keep handlers thin) ---

func (c *OrbitClient) ListSatellites(ctx context.Context, in *pb.ListSatellitesRequest) (*pb.ListSatellitesResponse, error) {
	var out *pb.ListSatellitesResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.ListSatellites(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetTLE(ctx context.Context, in *pb.GetTLERequest) (*pb.GetTLEResponse, error) {
	var out *pb.GetTLEResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetTLE(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetCurrentPosition(ctx context.Context, in *pb.GetCurrentPositionRequest) (*pb.PositionResponse, error) {
	var out *pb.PositionResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetCurrentPosition(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetTrack(ctx context.Context, in *pb.GetTrackRequest) (*pb.TrackResponse, error) {
	var out *pb.TrackResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetTrack(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetOrbitInfo(ctx context.Context, in *pb.GetOrbitInfoRequest) (*pb.OrbitInfoResponse, error) {
	var out *pb.OrbitInfoResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetOrbitInfo(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetSwath(ctx context.Context, in *pb.GetSwathRequest) (*pb.SwathResponse, error) {
	var out *pb.SwathResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetSwath(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetPolarCrossings(ctx context.Context, in *pb.GetPolarCrossingsRequest) (*pb.PolarCrossingsResponse, error) {
	var out *pb.PolarCrossingsResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetPolarCrossings(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetCoverageHeatmap(ctx context.Context, in *pb.GetCoverageHeatmapRequest) (*pb.CoverageHeatmapResponse, error) {
	var out *pb.CoverageHeatmapResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetCoverageHeatmap(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetFires(ctx context.Context, in *pb.GetFiresRequest) (*pb.GetFiresResponse, error) {
	var out *pb.GetFiresResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetFires(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) SimbadRegion(ctx context.Context, in *pb.SimbadRegionRequest) (*pb.JsonBlob, error) {
	var out *pb.JsonBlob
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.SimbadRegion(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) SimbadResolve(ctx context.Context, in *pb.SimbadResolveRequest) (*pb.JsonBlob, error) {
	var out *pb.JsonBlob
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.SimbadResolve(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) ListSurveys(ctx context.Context, in *pb.ListSurveysRequest) (*pb.JsonBlob, error) {
	var out *pb.JsonBlob
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.ListSurveys(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetCutout(ctx context.Context, in *pb.GetCutoutRequest) (*pb.JsonBlob, error) {
	var out *pb.JsonBlob
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetCutout(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetCutoutMulti(ctx context.Context, in *pb.GetCutoutMultiRequest) (*pb.JsonBlob, error) {
	var out *pb.JsonBlob
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetCutoutMulti(ctx, in)
		return e
	})
	return out, err
}

func (c *OrbitClient) GetSitePasses(ctx context.Context, in *pb.GetSitePassesRequest) (*pb.GetSitePassesResponse, error) {
	var out *pb.GetSitePassesResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.OrbitScienceClient) error {
		var e error
		out, e = cl.GetSitePasses(ctx, in)
		return e
	})
	return out, err
}
