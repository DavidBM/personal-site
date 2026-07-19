var FRAGMENT_SHADER = `
precision highp float;

#define M_PI 3.1415926535897932384626433832795

uniform sampler2D cloudTexture;
uniform sampler2D planetTexture;
uniform sampler2D difTexture;
uniform sampler2D ligthTexture;
uniform sampler2D normalTexture;
uniform float desplazamiento;
uniform float lightPositionX;
uniform float lightPositionY;
uniform float lightPositionZ;
uniform float width;

// Realistic globe orientation, all in degrees:
//   uSpin       = daily rotation around the planet's own (polar) axis
//   uObliquity  = axial tilt of that pole away from vertical
//   uPrecession = slow rotation of the tilt direction (the axis itself turning)
uniform float uSpin;
uniform float uObliquity;
uniform float uPrecession;

// View-space rotation from mouse/touch drag (arcball). Applied to each fragment
// BEFORE the auto spin/tilt/precession so a grabbed point follows the cursor
// while the underlying rotation keeps going.
uniform mat3 uDragRot;

// Sun direction as latitude/longitude (degrees). lat = height above the
// view plane (90 = straight up/top), lon = around (0 = toward camera/front,
// 180 = behind the planet).
uniform float sunLat;
uniform float sunLon;

// Screen-space placement (filter covers the whole window):
//   uScreen        = canvas size in CSS px  (vTextureCoord * uScreen = pixel pos)
//   planetCenter   = planet center in px
//   planetDiameter = planet (rim) diameter in px
// NOTE: do not name this 'resolution' — PixiJS reserves that filter uniform.
uniform vec2 uScreen;
uniform vec2 planetCenter;
uniform float planetDiameter;

varying vec2 vTextureCoord;

// Inspiration (and a lot of copy paste) from https://www.shadertoy.com/view/MldyDH

#define ATMOSPHERE_THICKNESS 0.2 //default 0.2
#define SCATTER_INTENSITY 10.0 //default 10
#define ATMOSPHERE_DENSITY 3.0 //default 3.0
#define ATMOSPHERE_COLOR vec3( 3.8, 13.5, 33.1 ) // default vec3( 3.8, 13.5, 33.1 )

#define PI 3.14159265359// scatter const
#define SCALE 0.9

const float R_INNER = 1.0;
//const float R = R_INNER + 0.5;
const int NUM_OUT_SCATTER = 3;
const int NUM_IN_SCATTER = 18;

vec3 fromlatlon(float lat, float lon) {
    return vec3(sin(lon*PI/180.) * cos(lat*PI/180.), sin(lat*PI/180.), cos(lon*PI/180.) * cos(lat*PI/180.));
}

// Written by GLtracy
// https://www.shadertoy.com/view/lslXDr

// ray intersects sphere
// e = -b +/- sqrt( b^2 - c )
vec2 ray_vs_sphere( vec3 p, vec3 dir, float r ) {
    float b = dot( p, dir );
    float c = dot( p, p ) - r * r;
    
    float d = b * b - c;
    if ( d < 0.0 ) {
        return vec2( 1e4, -1e4 );
    }
    d = sqrt( d);
    
    return vec2( -b - d, -b + d );
}

// Mie
// g : ( -0.75, -0.999 )
//      3 * ( 1 - g^2 )               1 + c^2
// F = ----------------- * -------------------------------
//      8pi * ( 2 + g^2 )     ( 1 + g^2 - 2 * g * c )^(3/2)
float phase_mie( float g, float c, float cc ) {
    float gg = g * g;
    
    float a = ( 1.0 - gg ) * ( 1.0 + cc );

    float b = 1.0 + gg - 2.0 * g * c;
    b *= sqrt( b );
    b *= 2.0 + gg;  
    
    return ( ATMOSPHERE_DENSITY / 8.0 / PI ) * a / b;
}

// Rayleigh
// g : 0
// F = 3/16PI * ( 1 + c^2 )
float phase_ray( float cc ) {
    return ( ATMOSPHERE_DENSITY / 16.0 / PI ) * ( 1.0 + cc );
}


float density( vec3 p, float ph ) {
    return exp( -max( length( p ) - R_INNER, 0.0 ) / ATMOSPHERE_THICKNESS / ph );
}

float optic( vec3 p, vec3 q, float ph ) {
    vec3 s = ( q - p ) / float( NUM_OUT_SCATTER );
    vec3 v = p + s * 0.5;
    
    float sum = 0.0;
    for ( int i = 0; i < NUM_OUT_SCATTER; i++ ) {
        sum += density( v, ph );
        v += s;
    }
    sum *= length( s );
    
    return sum;
}

vec3 in_scatter( vec3 o, vec3 dir, vec2 e, vec3 l ) {
    const float ph_ray = 0.05;
    const float ph_mie = 0.02;
    
    const vec3 k_ray = ATMOSPHERE_COLOR;
    const vec3 k_mie = vec3( 21.0 );
    const float k_mie_ex = 1.1;
    
    vec3 sum_ray = vec3( 0.0 );
    vec3 sum_mie = vec3( 0.0 );
    
    float n_ray0 = 0.0;
    float n_mie0 = 0.0;
    
    float len = ( e.y - e.x ) / float( NUM_IN_SCATTER );
    vec3 s = dir * len;
    vec3 v = o + dir * ( e.x + len * 0.5 );
    
    for ( int i = 0; i < NUM_IN_SCATTER; i++ ) {  
        float d_ray = density( v, ph_ray ) * len;
        float d_mie = density( v, ph_mie ) * len;
        
        n_ray0 += d_ray;
        n_mie0 += d_mie;
        
#if 0
        vec2 e = ray_vs_sphere( v, l, R_INNER );
        e.x = max( e.x, 0.0 );
        if ( e.x < e.y ) {
            v += s;
            continue;
        }
#endif
        
        vec2 f = ray_vs_sphere( v, l, R_INNER + ATMOSPHERE_THICKNESS );
        vec3 u = v + l * f.y;
        
        float n_ray1 = optic( v, u, ph_ray );
        float n_mie1 = optic( v, u, ph_mie );
        
        vec3 att = exp( - ( n_ray0 + n_ray1 ) * k_ray - ( n_mie0 + n_mie1 ) * k_mie * k_mie_ex );
        
        sum_ray += d_ray * att;
        sum_mie += d_mie * att;
        v += s;
    }
    
    float c  = dot( dir, -l );
    float cc = c * c;
    vec3 scatter =
        sum_ray * k_ray * phase_ray( cc ) +
        sum_mie * k_mie * phase_mie( -0.78, c, cc );
    
    
    return SCATTER_INTENSITY * scatter;
}

float getPixelWidth() {
    return 1.0 / width;
}

float getAlphaBorderBlending(float radius, float blendingEnd, float gradiendWidth) {
    float blendingStart = blendingEnd - gradiendWidth;

    if(radius <= blendingStart) return 1.0;
    if(radius >= blendingEnd) return 0.0;

    return (blendingEnd - radius) / gradiendWidth;
}

vec4 atmosphere(vec2 fragCoord, float lat, float lon, float radius, vec4 color, float diffussionIntensity, vec4 normalMap, vec4 nightLight, vec4 clouds) {
    vec4 fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    vec3 normalMapDir = vec3(normalMap);
    vec2 p = (2. * fragCoord.xy - vec2(1.0, 1.0)) / 1.0;

    vec3 camPos = vec3(0.0, 0.0, 10.0);
    vec3 w = normalize(-camPos);
    vec3 u = normalize(cross(w, vec3(0,1,0)));
    vec3 v = normalize(cross(u, w));
    mat3 camera = mat3(u, v, w);
    
    vec3 sun = fromlatlon(lat, lon);
    vec3 dir = normalize(camera * vec3(p / SCALE, length(camPos)));
              
    vec2 e = ray_vs_sphere(camPos, dir, R_INNER + ATMOSPHERE_THICKNESS);
    if (e.x > e.y) return vec4(0,0,0,0);
    
    vec2 f = ray_vs_sphere(camPos, dir, R_INNER);
    e.y = min(e.y, f.x);
    float dist = f.x;
    float light = 0.0;

    if (f.x < f.y) {
        vec3 q = camPos + dir * dist;
        light = dot(normalize(q - normalMapDir * 0.05), sun);
        float specular = pow(clamp(dot(normalize(sun - dir - normalMapDir * 0.05), q), 0., 1.), 64.);

        vec3 day = vec3(color) + 0.25 * specular * vec3(0.87, 0.75, 0.) * diffussionIntensity;

        fragColor.rgb = mix(vec3(nightLight), day * light, smoothstep(-0.1, 0.1, light));
    }

    float alpha = getAlphaBorderBlending(radius, 0.5, getPixelWidth());

    fragColor.rgb *= alpha;
    fragColor.a = alpha;

    fragColor.rgb = mix(vec3(nightLight), pow(fragColor.rgb, vec3(1./2.2)), smoothstep(-0.1, 0.1, light));

    fragColor.rgb *= alpha;
    fragColor.a = alpha;

    // Atmosphere scattering is emissive: add it to colour AND give it matching
    // coverage in alpha. Otherwise the halo is colour with alpha 0 (a premultiplied
    // pixel over "nothing"), so areas that should be fully transparent were not
    // exactly (0,0,0,0). Where there is neither planet nor glow, alpha stays 0.
    vec3 scatter = in_scatter(camPos, dir, e, sun);
    fragColor.rgb += scatter;
    fragColor.a = max(fragColor.a, clamp(max(scatter.r, max(scatter.g, scatter.b)), 0.0, 1.0));

    return fragColor;
}

// Expects a normnalized vector
// http://www.learningaboutelectronics.com/Articles/Cartesian-rectangular-to-spherical-coordinate-converter-calculator.php
vec2 vector3toLonLatNormalized( vec3 coords ) {
    coords = vec3(coords.z, coords.x, coords.y);

    float radius = sqrt(coords.x * coords.x + coords.y * coords.y + coords.z * coords.z);

    float lat = atan(coords.y / coords.x);

    float lon = acos(coords.z / radius);

    if(coords.x < 0.0) {
        lat += M_PI;
    }

    return vec2((lat+M_PI/2.0)/M_PI/2.0, lon / M_PI);
}

vec4 quat_from_axis_angle(vec3 axis, float angle) { 
  vec4 qr;
  float half_angle = (angle * 0.5) * M_PI / 180.0;
  qr.x = axis.x * sin(half_angle);
  qr.y = axis.y * sin(half_angle);
  qr.z = axis.z * sin(half_angle);
  qr.w = cos(half_angle);
  return qr;
}

vec3 rotate_vertex_position(vec3 position, vec3 axis, float angle) { 
  vec4 q = quat_from_axis_angle(axis, angle);
  vec3 v = position.xyz;
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main(void) {

    // Filter now covers the whole window, so derive everything from the pixel
    // position on screen instead of from the (clipped) sprite frame. Dividing
    // both axes by the same px diameter keeps the planet a true circle at any
    // window aspect ratio, and never clips it against a sprite-sized buffer.
    vec2 fragPx = vTextureCoord * uScreen;
    vec2 c = (fragPx - planetCenter) / planetDiameter; // 0 at center, +/-0.5 at rim, y-down

    // Surface uses y-up; rim sits at radius 0.5 (matches the old texResize geometry).
    vec2 screenPlanetXY = vec2(c.x, -c.y);

    // Atmosphere() expects the old sprite-normalized coord; 1.1053 reproduces it.
    vec2 atmCoord = c / 1.1053 + 0.5;

    float radius = length( screenPlanetXY);
    float halfRadius = length( screenPlanetXY * 2.0 );
    float angle = atan( screenPlanetXY.x, screenPlanetXY.y );
    
    float verticalCoordZ = sin(acos(halfRadius)) / 2.0;

    vec3 sphereVector = vec3(screenPlanetXY.x, screenPlanetXY.y, verticalCoordZ);

    // Planet orientation (body -> screen) is:
    //   precession(around vertical Y) * obliquity(tilt around X) * spin(around pole Y)
    // To look up the texture we need the inverse: take the on-screen point back
    // into the planet's body frame by applying those rotations in reverse.
    vec3 rotated = uDragRot * sphereVector;
    rotated = rotate_vertex_position(rotated, vec3(0.0, 1.0, 0.0), -uPrecession);
    rotated = rotate_vertex_position(rotated, vec3(1.0, 0.0, 0.0), -uObliquity);
    rotated = rotate_vertex_position(rotated, vec3(0.0, 1.0, 0.0), -uSpin);
    vec2 latlong = vector3toLonLatNormalized(rotated);

    vec2 finalPointWithDisplacement = vec2(latlong.x , latlong.y);

    gl_FragColor.rgba = atmosphere(
        atmCoord,
        sunLat,
        sunLon,
        radius,
        texture2D( planetTexture, finalPointWithDisplacement),
        texture2D( difTexture, finalPointWithDisplacement).r,
        texture2D( normalTexture, finalPointWithDisplacement),
        texture2D( ligthTexture, finalPointWithDisplacement),
        texture2D( cloudTexture, finalPointWithDisplacement)
    );

    //gl_FragColor.rgba = vec4(vTextureCoord.s, vTextureCoord.t, 0.0, 1.0);
    //gl_FragColor.rgba = texture2D( ligthTexture, finalPointWithDisplacement);
}
`;
