// Rotating-World Maze (VVVVVV-style) - Computer Graphics project
// ---------------------------------------------------------------------------
// Guide the ball to the goal. Gravity always pulls toward screen-bottom.
// Rotate the WHOLE maze 90 degrees to change where the ball falls.
//
//   Arrow Left / Right : nudge the ball
//   Q / E              : rotate the world (counter-clockwise / clockwise)
//   R                  : restart level / replay
//   SPACE              : start (on title screen)
//   ESC                : quit
//
// CG concepts demonstrated (mapped to syllabus units):
//   Unit 3  Scan conversion : Bresenham line + Midpoint circle (own code)
//                             dotted line style
//   Unit 4  Transformations : rotation of the maze about its center point
//   Unit 5  Clipping/Curves : Cohen-Sutherland line clipping + cubic Bezier
//   Unit 6  Light/Color     : radial-shaded ball, HSV per-level color
//   Unit 1  Animation       : eased rotation + particle burst
//
// Build (Windows/MinGW):  g++ stack.cpp -o maze -lfreeglut -lopengl32 -lglu32
// Build (Linux):          g++ stack.cpp -o maze -lglut -lGL -lGLU

#include <GL/glut.h>
#include <vector>
#include <string>
#include <cmath>
#include <cstdlib>

// ---- axis-aligned rectangle ----
struct Rect { float x, y, w, h; };

// ---- spike hazard (touch = restart level); may slide back and forth ----
// offset = sin(2*pi*(t/period + phase)) * (ax, ay); period 0 = static
struct Hazard { Rect r; float ax, ay, period, phase; };

// ---- one level ----
struct Level {
    std::string name;
    float bx, by;
    Rect  goal;
    std::vector<Rect> walls;
    std::vector<Hazard> hazards;
};

std::vector<Level> levels;
int levelIndex = 0;
int levelTime  = 0;     // physics frames since (re)start, drives moving hazards
int deaths     = 0;

// ---- ball ----
float bx, by, vx = 0, vy = 0;
const float R = 12.0f;

// ---- rotation ----
int   stepCount   = 0;
float visualAngle = 0;
float targetAngle = 0;
bool  rotating    = false;

int   moveInput = 0;

// ---- game state ----
enum { TITLE, PLAY, CLEARED, DEAD, WIN };
int state = TITLE;

int levelStartMs = 0, totalMs = 0, lastLevelMs = 0, clearTimer = 0, moves = 0;

const float CX = 300, CY = 300;

// gravity + screen-right directions per rotation index
float gx[4] = { 0, -1,  0,  1 };
float gy[4] = { -1, 0,  1,  0 };
float rx[4] = { 1,  0, -1,  0 };
float ry[4] = { 0, -1,  0,  1 };

const float GRAV = 0.30f, MOVE = 0.70f, MAXV = 6.0f;

// ---- particles (goal celebration) ----
struct Particle { float x, y, vx, vy, life; };
std::vector<Particle> particles;

// ===========================================================================
//  Unit 6 : simple HSV -> RGB (used for per-level color scheme)
// ===========================================================================
void hsv2rgb(float h, float s, float v, float &r, float &g, float &b) {
    float c = v * s;
    float x = c * (1 - fabs(fmodf(h / 60.0f, 2) - 1));
    float m = v - c;
    float r1, g1, b1;
    if      (h <  60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else              { r1 = c; g1 = 0; b1 = x; }
    r = r1 + m; g = g1 + m; b = b1 + m;
}

// ===========================================================================
//  Unit 3 : Bresenham line drawing (with optional dotted line style)
// ===========================================================================
void bresenham(int x0, int y0, int x1, int y1, bool dotted) {
    int dx = abs(x1 - x0), dy = abs(y1 - y0);
    int sx = (x0 < x1) ? 1 : -1;
    int sy = (y0 < y1) ? 1 : -1;
    int err = dx - dy;
    int i = 0;
    glBegin(GL_POINTS);
    while (true) {
        if (!dotted || (i % 8 < 4)) glVertex2i(x0, y0); // dotted = skip runs
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
        i++;
    }
    glEnd();
}

// ===========================================================================
//  Unit 3 : Midpoint circle algorithm (used for the ball outline)
// ===========================================================================
void midpointCircle(int xc, int yc, int r) {
    int x = 0, y = r;
    int p = 1 - r;
    glBegin(GL_POINTS);
    while (x <= y) {
        glVertex2i(xc + x, yc + y); glVertex2i(xc - x, yc + y);
        glVertex2i(xc + x, yc - y); glVertex2i(xc - x, yc - y);
        glVertex2i(xc + y, yc + x); glVertex2i(xc - y, yc + x);
        glVertex2i(xc + y, yc - x); glVertex2i(xc - y, yc - x);
        x++;
        if (p < 0) p += 2 * x + 1;
        else { y--; p += 2 * (x - y) + 1; }
    }
    glEnd();
}

// ===========================================================================
//  Unit 5 : Cohen-Sutherland line clipping against the play area [0,600]^2
// ===========================================================================
const int INSIDE = 0, C_LEFT = 1, C_RIGHT = 2, C_BOTTOM = 4, C_TOP = 8;
const float XMIN = 0, YMIN = 0, XMAX = 600, YMAX = 600;

int regionCode(float x, float y) {
    int c = INSIDE;
    if (x < XMIN) c |= C_LEFT; else if (x > XMAX) c |= C_RIGHT;
    if (y < YMIN) c |= C_BOTTOM; else if (y > YMAX) c |= C_TOP;
    return c;
}

// returns true if any part is visible; clips endpoints in place
bool cohenSutherland(float &x0, float &y0, float &x1, float &y1) {
    int c0 = regionCode(x0, y0), c1 = regionCode(x1, y1);
    while (true) {
        if (!(c0 | c1)) return true;      // both inside
        if (c0 & c1)    return false;     // trivially rejected
        int c = c0 ? c0 : c1;
        float x = 0, y = 0;
        if (c & C_TOP)         { x = x0 + (x1 - x0) * (YMAX - y0) / (y1 - y0); y = YMAX; }
        else if (c & C_BOTTOM) { x = x0 + (x1 - x0) * (YMIN - y0) / (y1 - y0); y = YMIN; }
        else if (c & C_RIGHT)  { y = y0 + (y1 - y0) * (XMAX - x0) / (x1 - x0); x = XMAX; }
        else                   { y = y0 + (y1 - y0) * (XMIN - x0) / (x1 - x0); x = XMIN; }
        if (c == c0) { x0 = x; y0 = y; c0 = regionCode(x0, y0); }
        else         { x1 = x; y1 = y; c1 = regionCode(x1, y1); }
    }
}

// ===========================================================================
//  Unit 5 : cubic Bezier curve (Bernstein blending functions)
// ===========================================================================
void drawBezier(float p[4][2]) {
    glBegin(GL_LINE_STRIP);
    for (int i = 0; i <= 30; i++) {
        float t = i / 30.0f, u = 1 - t;
        // cubic Bernstein blending functions
        float b0 = u * u * u;
        float b1 = 3 * u * u * t;
        float b2 = 3 * u * t * t;
        float b3 = t * t * t;
        float x = b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0];
        float y = b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1];
        glVertex2f(x, y);
    }
    glEnd();
}

// ===========================================================================
//  Levels
// ===========================================================================
// Level data is kept identical to engine.js (web version).
Hazard spike(float x, float y, float w, float h) { return { {x, y, w, h}, 0, 0, 0, 0 }; }
Hazard mover(float x, float y, float w, float h, float ax, float ay, float period, float phase) {
    return { {x, y, w, h}, ax, ay, period, phase };
}

void buildLevels() {
    levels.clear();
    { Level L; L.name = "First Drop"; L.bx = 300; L.by = 540; L.goal = {270, 20, 60, 50};
      levels.push_back(L); }
    { Level L; L.name = "The Ledge"; L.bx = 120; L.by = 540; L.goal = {500, 20, 60, 50};
      L.walls.push_back({0, 120, 340, 30});
      levels.push_back(L); }
    { Level L; L.name = "The Wall"; L.bx = 120; L.by = 540; L.goal = {430, 540, 60, 50};
      L.walls.push_back({285, 150, 30, 450});
      levels.push_back(L); }
    { Level L; L.name = "Switchback"; L.bx = 100; L.by = 540; L.goal = {520, 540, 60, 50};
      L.walls.push_back({200, 150, 30, 450});
      L.walls.push_back({400,   0, 30, 450});
      levels.push_back(L); }
    { Level L; L.name = "Triple Fold"; L.bx = 80; L.by = 540; L.goal = {520, 540, 60, 50};
      L.walls.push_back({150, 200, 30, 400});
      L.walls.push_back({300,   0, 30, 400});
      L.walls.push_back({450, 200, 30, 400});
      levels.push_back(L); }

    // ---- new levels: red spikes restart the level on touch ----
    { Level L; L.name = "Spike Floor"; L.bx = 80; L.by = 540; L.goal = {520, 20, 60, 50};
      L.walls.push_back({0, 300, 400, 30});
      L.hazards.push_back(spike(0, 0, 505, 18));
      levels.push_back(L); }
    { Level L; L.name = "Zig-Zag"; L.bx = 60; L.by = 540; L.goal = {20, 20, 60, 50};
      L.walls.push_back({0, 450, 480, 30});
      L.walls.push_back({120, 300, 480, 30});
      L.walls.push_back({0, 150, 480, 30});
      L.hazards.push_back(spike(200, 480, 60, 16));
      L.hazards.push_back(spike(200, 0, 80, 18));
      levels.push_back(L); }
    { Level L; L.name = "The Vault"; L.bx = 540; L.by = 540; L.goal = {260, 255, 100, 90};
      L.walls.push_back({210, 360, 180, 30});
      L.walls.push_back({210, 210, 180, 30});
      L.walls.push_back({210, 210, 30, 180});
      L.hazards.push_back(spike(0, 0, 18, 600));
      levels.push_back(L); }
    { Level L; L.name = "Pendulum"; L.bx = 300; L.by = 540; L.goal = {270, 20, 60, 50};
      L.walls.push_back({240, 420, 120, 30});
      L.hazards.push_back(mover(200, 290, 200, 20, 180, 0, 180, 0));
      L.hazards.push_back(mover(200, 150, 200, 20, 180, 0, 180, 0.25f));
      levels.push_back(L); }
    { Level L; L.name = "Pistons"; L.bx = 40; L.by = 540; L.goal = {530, 20, 60, 50};
      L.hazards.push_back(mover(170, -320, 30, 600, 0,  340, 200, 0));
      L.hazards.push_back(mover(290,  320, 30, 600, 0, -340, 200, 0.33f));
      L.hazards.push_back(mover(410, -320, 30, 600, 0,  340, 200, 0.66f));
      levels.push_back(L); }
    { Level L; L.name = "Spiral"; L.bx = 40; L.by = 540; L.goal = {245, 245, 110, 110};
      L.walls.push_back({90, 90, 420, 30});
      L.walls.push_back({90, 480, 420, 30});
      L.walls.push_back({90, 90, 30, 420});
      L.walls.push_back({480, 90, 30, 330});
      L.walls.push_back({200, 200, 200, 30});
      L.walls.push_back({200, 370, 200, 30});
      L.walls.push_back({370, 200, 30, 200});
      L.walls.push_back({200, 200, 30, 110});
      levels.push_back(L); }
    { Level L; L.name = "Final Exam"; L.bx = 540; L.by = 540; L.goal = {20, 530, 60, 50};
      L.walls.push_back({480, 500, 120, 25});
      L.walls.push_back({250, 250, 200, 30});
      L.walls.push_back({0, 460, 160, 25});
      L.walls.push_back({160, 460, 25, 100});
      L.hazards.push_back(spike(300, 0, 100, 15));
      L.hazards.push_back(spike(250, 585, 120, 15));
      L.hazards.push_back(mover(460, 300, 140, 20, 0, 170, 220, 0));
      levels.push_back(L); }
}

// current rectangle of a hazard at the current level time
Rect hazardRect(const Hazard &h) {
    if (h.period == 0) return h.r;
    float s = sinf(2 * 3.14159265f * (levelTime / h.period + h.phase));
    return { h.r.x + h.ax * s, h.r.y + h.ay * s, h.r.w, h.r.h };
}

// put the ball back at the level start (used on restart and on death)
void resetBall() {
    Level &L = levels[levelIndex];
    bx = L.bx; by = L.by; vx = vy = 0;
    stepCount = 0; visualAngle = targetAngle = 0; rotating = false;
    levelTime = 0;
    particles.clear();
}

void loadLevel(int i) {
    levelIndex = i;
    resetBall();
    moveInput = 0;
    levelStartMs = glutGet(GLUT_ELAPSED_TIME);
}

// ===========================================================================
//  Drawing helpers
// ===========================================================================
void fillRect(const Rect &r) {
    glBegin(GL_QUADS);
        glVertex2f(r.x, r.y);           glVertex2f(r.x + r.w, r.y);
        glVertex2f(r.x + r.w, r.y + r.h); glVertex2f(r.x, r.y + r.h);
    glEnd();
}

void rectOutlineBresenham(const Rect &r) {
    int x0 = (int)r.x, y0 = (int)r.y, x1 = (int)(r.x + r.w), y1 = (int)(r.y + r.h);
    bresenham(x0, y0, x1, y0, false);
    bresenham(x1, y0, x1, y1, false);
    bresenham(x1, y1, x0, y1, false);
    bresenham(x0, y1, x0, y0, false);
}

// Unit 5: clip a rectangle to the play area (pistons slide in from outside it)
bool clipRect(const Rect &r, Rect &out) {
    float x0 = fmaxf(XMIN, r.x), y0 = fmaxf(YMIN, r.y);
    float x1 = fminf(XMAX, r.x + r.w), y1 = fminf(YMAX, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) return false;
    out = { x0, y0, x1 - x0, y1 - y0 };
    return true;
}

// spiky hazard: dark body + bright teeth along its long side
void drawHazard(const Rect &r) {
    glColor3f(0.45f, 0.10f, 0.14f);
    fillRect(r);
    glColor3f(0.95f, 0.32f, 0.34f);
    bool horizontal = r.w >= r.h;
    float len = horizontal ? r.w : r.h;
    int n = (int)roundf(len / 14); if (n < 1) n = 1;
    float seg = len / n;
    glBegin(GL_TRIANGLES);
    for (int i = 0; i < n; i++) {
        float a = i * seg;
        if (horizontal) {
            glVertex2f(r.x + a, r.y); glVertex2f(r.x + a + seg / 2, r.y + r.h); glVertex2f(r.x + a + seg, r.y);
        } else {
            glVertex2f(r.x, r.y + a); glVertex2f(r.x + r.w, r.y + a + seg / 2); glVertex2f(r.x, r.y + a + seg);
        }
    }
    glEnd();
}

// Unit 6 : radial-shaded ball (bright center -> dark rim = fake point light)
void drawBallShaded() {
    glBegin(GL_TRIANGLE_FAN);
        glColor3f(1.0f, 0.80f, 0.65f);            // lit center
        glVertex2f(bx - R * 0.25f, by + R * 0.25f);
        glColor3f(0.85f, 0.35f, 0.20f);           // darker rim
        for (int a = 0; a <= 360; a += 15) {
            float t = a * 3.14159f / 180.0f;
            glVertex2f(bx + cosf(t) * R, by + sinf(t) * R);
        }
    glEnd();
    // crisp outline via midpoint circle (Unit 3)
    glColor3f(0.2f, 0.08f, 0.05f);
    midpointCircle((int)bx, (int)by, (int)R);
}

void drawText(float x, float y, const std::string &s, void *font) {
    glRasterPos2f(x, y);
    for (unsigned int i = 0; i < s.size(); i++)
        glutBitmapCharacter(font, s[i]);
}

std::string timeStr(int ms) {
    int tenths = ms / 100;
    return std::to_string(tenths / 10) + "." + std::to_string(tenths % 10) + "s";
}

// ===========================================================================
//  Scene rendering
// ===========================================================================
void drawMaze() {
    Level &L = levels[levelIndex];

    // per-level color via HSV (Unit 6)
    float hr, hg, hb;
    hsv2rgb((levelIndex * 55) % 360, 0.55f, 0.85f, hr, hg, hb);

    glPushMatrix();
        glTranslatef(CX, CY, 0);
        glRotatef(visualAngle, 0, 0, 1);     // Unit 4: rotate about center
        glTranslatef(-CX, -CY, 0);

        // border via Bresenham (Unit 3)
        glColor3f(0.35f, 0.40f, 0.50f);
        rectOutlineBresenham({0, 0, 600, 600});

        // gravity guide line, clipped with Cohen-Sutherland (Unit 5),
        // rasterized dotted with Bresenham (Unit 3 line style)
        int g = ((stepCount % 4) + 4) % 4;
        float lx0 = bx, ly0 = by;
        float lx1 = bx + gx[g] * 1000, ly1 = by + gy[g] * 1000;
        if (state != DEAD && cohenSutherland(lx0, ly0, lx1, ly1)) {
            glColor3f(0.45f, 0.50f, 0.60f);
            bresenham((int)lx0, (int)ly0, (int)lx1, (int)ly1, true);
        }

        // walls (light fill + Bresenham outline)
        glColor3f(0.86f, 0.88f, 0.92f);
        for (unsigned int i = 0; i < L.walls.size(); i++) fillRect(L.walls[i]);
        glColor3f(0.55f, 0.58f, 0.66f);
        for (unsigned int i = 0; i < L.walls.size(); i++) rectOutlineBresenham(L.walls[i]);

        // spike hazards, clipped to the play area
        for (unsigned int i = 0; i < L.hazards.size(); i++) {
            Rect hr;
            if (clipRect(hazardRect(L.hazards[i]), hr)) drawHazard(hr);
        }

        // goal (HSV color) + Bezier banner arc above it (Unit 5)
        glColor3f(hr, hg, hb);
        fillRect(L.goal);
        float p[4][2] = {
            { L.goal.x - 5,            L.goal.y + L.goal.h },
            { L.goal.x + L.goal.w*0.2f, L.goal.y + L.goal.h + 55 },
            { L.goal.x + L.goal.w*0.8f, L.goal.y + L.goal.h + 55 },
            { L.goal.x + L.goal.w + 5, L.goal.y + L.goal.h }
        };
        glColor3f(hr, hg, hb);
        drawBezier(p);

        // particles (goal color on clear, red on death)
        float pr = hr, pg = hg, pb = hb;
        if (state == DEAD) { pr = 0.95f; pg = 0.30f; pb = 0.30f; }
        for (unsigned int i = 0; i < particles.size(); i++) {
            float a = particles[i].life / 40.0f;
            glColor3f(pr * a + 0.2f, pg * a + 0.2f, pb * a + 0.1f);
            glBegin(GL_QUADS);
                float px = particles[i].x, py = particles[i].y, s = 4;
                glVertex2f(px - s, py - s); glVertex2f(px + s, py - s);
                glVertex2f(px + s, py + s); glVertex2f(px - s, py + s);
            glEnd();
        }

        // ball (shaded + midpoint-circle outline)
        if (state != DEAD) drawBallShaded();
    glPopMatrix();
}

void display() {
    glClear(GL_COLOR_BUFFER_BIT);
    glLoadIdentity();

    if (state == TITLE) {
        glColor3f(0.96f, 0.50f, 0.32f);
        drawText(120, 420, "ROTATING - WORLD MAZE", GLUT_BITMAP_TIMES_ROMAN_24);
        glColor3f(0.90f, 0.92f, 0.95f);
        drawText(150, 350, "Rotate the maze so the ball falls to the goal.", GLUT_BITMAP_HELVETICA_12);
        drawText(150, 330, "Red spikes send you back to the start.", GLUT_BITMAP_HELVETICA_12);
        drawText(210, 310, "Arrows = move    Q / E = rotate", GLUT_BITMAP_HELVETICA_18);
        drawText(230, 250, "Press SPACE to start", GLUT_BITMAP_HELVETICA_18);
        glutSwapBuffers();
        return;
    }

    if (state == WIN) {
        glColor3f(0.30f, 0.80f, 0.62f);
        drawText(210, 400, "ALL LEVELS CLEARED!", GLUT_BITMAP_TIMES_ROMAN_24);
        glColor3f(0.90f, 0.92f, 0.95f);
        drawText(215, 340, "Total time: " + timeStr(totalMs), GLUT_BITMAP_HELVETICA_18);
        drawText(215, 310, "Rotations: " + std::to_string(moves) + "   Deaths: " + std::to_string(deaths),
                 GLUT_BITMAP_HELVETICA_18);
        drawText(215, 260, "Press R to replay", GLUT_BITMAP_HELVETICA_18);
        glutSwapBuffers();
        return;
    }

    // PLAY or CLEARED -> draw the maze
    drawMaze();

    int shownMs = (state == CLEARED) ? lastLevelMs
                                     : totalMs + (glutGet(GLUT_ELAPSED_TIME) - levelStartMs);
    glColor3f(0.90f, 0.92f, 0.95f);
    drawText(-120, 715, "Level " + std::to_string(levelIndex + 1) + " / "
                        + std::to_string((int)levels.size()) + "  " + levels[levelIndex].name,
             GLUT_BITMAP_HELVETICA_18);
    drawText(400, 715, "Time " + timeStr(shownMs) + "   Rot " + std::to_string(moves)
                       + "   Deaths " + std::to_string(deaths), GLUT_BITMAP_HELVETICA_12);
    drawText(-120, -110, "Arrows: move   Q/E: rotate   R: restart", GLUT_BITMAP_HELVETICA_12);

    if (state == CLEARED) {
        glColor3f(0.30f, 0.80f, 0.62f);
        drawText(230, 340, "LEVEL CLEAR!", GLUT_BITMAP_TIMES_ROMAN_24);
    }

    glutSwapBuffers();
}

// ===========================================================================
//  Physics
// ===========================================================================
bool overlap(const Rect &w) {
    return (bx + R > w.x) && (bx - R < w.x + w.w) &&
           (by + R > w.y) && (by - R < w.y + w.h);
}
void resolveX() {
    Level &L = levels[levelIndex];
    for (unsigned int i = 0; i < L.walls.size(); i++) {
        Rect &w = L.walls[i];
        if (overlap(w)) { bx = (bx < w.x + w.w/2) ? w.x - R : w.x + w.w + R; vx = 0; }
    }
    if (bx < R) { bx = R; vx = 0; }
    if (bx > 600 - R) { bx = 600 - R; vx = 0; }
}
void resolveY() {
    Level &L = levels[levelIndex];
    for (unsigned int i = 0; i < L.walls.size(); i++) {
        Rect &w = L.walls[i];
        if (overlap(w)) { by = (by < w.y + w.h/2) ? w.y - R : w.y + w.h + R; vy = 0; }
    }
    if (by < R) { by = R; vy = 0; }
    if (by > 600 - R) { by = 600 - R; vy = 0; }
}

void spawnParticles() {
    Rect &g = levels[levelIndex].goal;
    float cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    for (int i = 0; i < 24; i++) {
        Particle p;
        p.x = cx; p.y = cy;
        float ang = (rand() % 360) * 3.14159f / 180.0f;
        float spd = 2 + (rand() % 30) / 10.0f;
        p.vx = cosf(ang) * spd; p.vy = sinf(ang) * spd;
        p.life = 40;
        particles.push_back(p);
    }
}

bool reachedGoal() {
    Rect &g = levels[levelIndex].goal;
    return (bx + R > g.x) && (bx - R < g.x + g.w) &&
           (by + R > g.y) && (by - R < g.y + g.h);
}

// circle vs rect (slightly forgiving so grazing a spike is fine)
bool hitHazard() {
    Level &L = levels[levelIndex];
    for (unsigned int i = 0; i < L.hazards.size(); i++) {
        Rect r = hazardRect(L.hazards[i]);
        float cx = fmaxf(r.x, fminf(bx, r.x + r.w));
        float cy = fmaxf(r.y, fminf(by, r.y + r.h));
        float dx = bx - cx, dy = by - cy, rad = R - 2;
        if (dx * dx + dy * dy < rad * rad) return true;
    }
    return false;
}

void spawnDeathParticles() {
    for (int i = 0; i < 24; i++) {
        Particle p;
        p.x = bx; p.y = by;
        float ang = (rand() % 360) * 3.14159f / 180.0f;
        float spd = 2 + (rand() % 30) / 10.0f;
        p.vx = cosf(ang) * spd; p.vy = sinf(ang) * spd;
        p.life = 40;
        particles.push_back(p);
    }
}

void update(int value) {
    if (state == PLAY) {
        if (rotating) {
            visualAngle += (targetAngle - visualAngle) * 0.15f;
            if (fabs(targetAngle - visualAngle) < 0.5f) { visualAngle = targetAngle; rotating = false; }
        } else {
            int g = ((stepCount % 4) + 4) % 4;
            vx += gx[g] * GRAV + moveInput * MOVE * rx[g];
            vy += gy[g] * GRAV + moveInput * MOVE * ry[g];
            vx *= 0.99f; vy *= 0.99f;
            float sp = sqrtf(vx*vx + vy*vy);
            if (sp > MAXV) { vx = vx/sp*MAXV; vy = vy/sp*MAXV; }
            bx += vx; resolveX();
            by += vy; resolveY();
            levelTime++;

            if (hitHazard()) {
                deaths++;
                spawnDeathParticles();
                state = DEAD;
                clearTimer = 45;
            } else if (reachedGoal()) {
                lastLevelMs = glutGet(GLUT_ELAPSED_TIME) - levelStartMs;
                totalMs += lastLevelMs;
                spawnParticles();
                state = CLEARED;
                clearTimer = 55;
            }
        }
    } else if (state == CLEARED || state == DEAD) {
        for (unsigned int i = 0; i < particles.size(); i++) {
            particles[i].x += particles[i].vx;
            particles[i].y += particles[i].vy;
            particles[i].vy -= 0.12f;   // little gravity on sparks
            particles[i].life -= 1;
        }
        if (--clearTimer <= 0) {
            if (state == DEAD) { resetBall(); state = PLAY; }   // timer keeps running
            else if (levelIndex + 1 < (int)levels.size()) { loadLevel(levelIndex + 1); state = PLAY; }
            else state = WIN;
        }
    }

    glutPostRedisplay();
    glutTimerFunc(16, update, 0);
}

// ===========================================================================
//  Input
// ===========================================================================
void keyboard(unsigned char key, int x, int y) {
    if (key == 27) exit(0);

    if (state == TITLE) {
        if (key == ' ') { totalMs = 0; moves = 0; deaths = 0; loadLevel(0); state = PLAY; }
        return;
    }
    if (key == 'r' || key == 'R') {
        if (state == WIN) { levelIndex = 0; totalMs = 0; moves = 0; deaths = 0; }
        loadLevel(levelIndex);
        state = PLAY;
        return;
    }
    if (state == PLAY && !rotating) {
        if (key == 'q' || key == 'Q') { stepCount++; targetAngle = stepCount * 90.0f; rotating = true; moves++; }
        if (key == 'e' || key == 'E') { stepCount--; targetAngle = stepCount * 90.0f; rotating = true; moves++; }
    }
}
void specialDown(int key, int x, int y) {
    if (key == GLUT_KEY_LEFT)  moveInput = -1;
    if (key == GLUT_KEY_RIGHT) moveInput =  1;
}
void specialUp(int key, int x, int y) {
    if (key == GLUT_KEY_LEFT  && moveInput == -1) moveInput = 0;
    if (key == GLUT_KEY_RIGHT && moveInput ==  1) moveInput = 0;
}

void init() {
    glClearColor(0.13f, 0.15f, 0.20f, 1.0f);
    glPointSize(2.0f);
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    gluOrtho2D(-130, 730, -130, 730);   // room for rotated corners
    glMatrixMode(GL_MODELVIEW);
    srand(1234);
}

int main(int argc, char **argv) {
    glutInit(&argc, argv);
    glutInitDisplayMode(GLUT_DOUBLE | GLUT_RGB);
    glutInitWindowSize(600, 600);
    glutCreateWindow("Rotating-World Maze");

    init();
    buildLevels();
    loadLevel(0);

    glutDisplayFunc(display);
    glutKeyboardFunc(keyboard);
    glutSpecialFunc(specialDown);
    glutSpecialUpFunc(specialUp);
    glutTimerFunc(0, update, 0);

    glutMainLoop();
    return 0;
}
