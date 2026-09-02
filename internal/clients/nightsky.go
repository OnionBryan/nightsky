// Package clients — reconnecting gRPC client for the nightsky science worker.
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

	pb "noaa21_orbit/api/proto/nightsky/v1"
)

// NightskyClient wraps NightskyScienceClient with dial + reconnect.
type NightskyClient struct {
	addr string

	mu     sync.Mutex
	conn   *grpc.ClientConn
	client pb.NightskyScienceClient
}

func NewNightskyClient(addr string) (*NightskyClient, error) {
	c := &NightskyClient{addr: addr}
	if err := c.dial(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *NightskyClient) dial() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dialLocked()
}

func (c *NightskyClient) dialLocked() error {
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
	c.client = pb.NewNightskyScienceClient(conn)
	return nil
}

func (c *NightskyClient) Close() error {
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

func (c *NightskyClient) getClient() pb.NightskyScienceClient {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.client
}

func nightskyTransient(err error) bool {
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

func (c *NightskyClient) Invoke(ctx context.Context, fn func(context.Context, pb.NightskyScienceClient) error) error {
	client := c.getClient()
	if client == nil {
		if err := c.dial(); err != nil {
			return err
		}
		client = c.getClient()
	}
	err := fn(ctx, client)
	if err == nil || !nightskyTransient(err) {
		return err
	}
	log.Printf("nightsky gRPC transient error (%v); reconnecting to %s", err, c.addr)
	if dialErr := c.dial(); dialErr != nil {
		return err
	}
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

func (c *NightskyClient) Health(ctx context.Context, in *pb.HealthRequest) (*pb.HealthResponse, error) {
	var out *pb.HealthResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) error {
		var e error
		out, e = cl.Health(ctx, in)
		return e
	})
	return out, err
}

func (c *NightskyClient) callJSON(
	ctx context.Context,
	fn func(context.Context, pb.NightskyScienceClient) (*pb.JsonResponse, error),
) (*pb.JsonResponse, error) {
	var out *pb.JsonResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) error {
		var e error
		out, e = fn(ctx, cl)
		return e
	})
	return out, err
}

func (c *NightskyClient) Geocode(ctx context.Context, in *pb.GeocodeRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Geocode(ctx, in)
	})
}

func (c *NightskyClient) Options(ctx context.Context, in *pb.Empty) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Options(ctx, in)
	})
}

func (c *NightskyClient) Planets(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Planets(ctx, in)
	})
}

func (c *NightskyClient) Moon(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Moon(ctx, in)
	})
}

func (c *NightskyClient) LocationInfo(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.LocationInfo(ctx, in)
	})
}

func (c *NightskyClient) GeostationaryVisible(ctx context.Context, in *pb.GeoVisibleRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.GeostationaryVisible(ctx, in)
	})
}

func (c *NightskyClient) GeostationaryArc(ctx context.Context, in *pb.GeoArcRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.GeostationaryArc(ctx, in)
	})
}

func (c *NightskyClient) GeostationaryLookup(ctx context.Context, in *pb.GeoLookupRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.GeostationaryLookup(ctx, in)
	})
}

func (c *NightskyClient) GeostationaryList(ctx context.Context, in *pb.CategoryRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.GeostationaryList(ctx, in)
	})
}

func (c *NightskyClient) Twilight(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Twilight(ctx, in)
	})
}

func (c *NightskyClient) RiseSet(ctx context.Context, in *pb.RiseSetRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.RiseSet(ctx, in)
	})
}

func (c *NightskyClient) Weather(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Weather(ctx, in)
	})
}

func (c *NightskyClient) GenerateSky(ctx context.Context, in *pb.GenerateSkyRequest) (*pb.ImageResponse, error) {
	var out *pb.ImageResponse
	err := c.Invoke(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) error {
		var e error
		out, e = cl.GenerateSky(ctx, in)
		return e
	})
	return out, err
}

func (c *NightskyClient) AuroraKp(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.AuroraKp(ctx, in)
	})
}

func (c *NightskyClient) LightPollution(ctx context.Context, in *pb.LatLonRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.LightPollution(ctx, in)
	})
}

func (c *NightskyClient) SatelliteTLE(ctx context.Context, in *pb.SatelliteTLERequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.SatelliteTLE(ctx, in)
	})
}

func (c *NightskyClient) Ephemeris(ctx context.Context, in *pb.EphemerisRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.Ephemeris(ctx, in)
	})
}

func (c *NightskyClient) SessionGoNoGo(ctx context.Context, in *pb.SessionGoNoGoRequest) (*pb.JsonResponse, error) {
	return c.callJSON(ctx, func(ctx context.Context, cl pb.NightskyScienceClient) (*pb.JsonResponse, error) {
		return cl.SessionGoNoGo(ctx, in)
	})
}
