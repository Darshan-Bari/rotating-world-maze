# Rotating-World Maze

A computer graphics project: guide the ball to the goal by rotating the whole maze 90 degrees at a time. Gravity always pulls toward the bottom of the screen. Red spikes send you back to the start.

**Play in the browser:** https://darshan-bari.github.io/rotating-world-maze/

## Controls

| Key | Action |
| --- | --- |
| Left / Right arrows | Move the ball |
| Q / E | Rotate the world counter-clockwise / clockwise |
| R | Restart the level |
| Space | Start |

On phones, use the on-screen buttons.

## Levels

There are 12 levels: the 5 original wall mazes, then Spike Floor, Zig-Zag, The Vault, Pendulum (sliding spike bars), Pistons (moving spike columns), Spiral and Final Exam. `node tools/verify.js` searches for a solution to every level and fails if any level can't be solved. The deploy workflow runs it on every push.

## CG algorithms (implemented by hand)

- Bresenham line drawing, including a dotted line style (Unit 3)
- Midpoint circle algorithm (Unit 3)
- Rotation about the maze center (Unit 4)
- Cohen-Sutherland line clipping and cubic Bezier curves (Unit 5)
- Radial shading and HSV per-level colors (Unit 6)
- Eased rotation animation and particle bursts (Unit 1)

## Files

- `stack.cpp`: the original OpenGL/GLUT version
- `index.html`, `game.js`, `engine.js`: browser version (HTML5 canvas), deployed to GitHub Pages
- `tools/verify.js`: level solvability check

## Build the desktop version

```
g++ stack.cpp -o maze -lfreeglut -lopengl32 -lglu32   # Windows / MinGW
g++ stack.cpp -o maze -lglut -lGL -lGLU               # Linux
```
