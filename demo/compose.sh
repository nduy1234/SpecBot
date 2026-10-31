#!/bin/zsh
# Rebuilds the 60s demo: original video + live 3D footage (3d.webm) + Halloween voiceover segments.
set -e
cd "$(dirname "$0")"
F=$(cat /private/tmp/claude-501/-Users-take-Library-Application-Support-Claude-scratch-workspaces-dc8e4108-4634-4b95-a2a9-1bf7926c320c-73410535-eea1-4f2b-a623-15ff1bf45e06-scratch-2026-10-31-ab56d9/909bae78-3207-4843-8849-4984e3aa224d/scratchpad/ffpath)
A=""; M=""
for i in 0 1 2 3 4 5 6; do n=$((i+2)); ms=$(awk "BEGIN{print int($(cat seg$i.start)*1000)}"); A="${A}[${n}:a]aresample=48000,adelay=${ms}|${ms}[s${i}];"; M="${M}[s${i}]"; done
"$F" -hide_banner -loglevel error -y -i "/Users/take/Downloads/SpecBot_demo_60s (1).mp4" -i 3d.webm -i seg0.aiff -i seg1.aiff -i seg2.aiff -i seg3.aiff -i seg4.aiff -i seg5.aiff -i seg6.aiff \
  -filter_complex "[1:v]fps=30,split=2[x][y];[x]trim=0:17,setpts=PTS-STARTPTS+10/TB,scale=1216:760,crop=1174:760[a];[y]trim=17:32,setpts=PTS-STARTPTS+27/TB,scale=947:592,crop=914:592[b];[0:v][a]overlay=694:116:enable='between(t,10,27)':eof_action=pass[v1];[v1][b]overlay=34:152:enable='between(t,27,42)':eof_action=pass[v];${A}${M}amix=inputs=7:normalize=0,volume=1.4,apad,atrim=0:60[au]" \
  -map "[v]" -map "[au]" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -t 60 -movflags +faststart SpecBot_demo_60s_3D_halloween.mp4
"$F" -hide_banner -loglevel error -y -i SpecBot_demo_60s_3D_halloween.mp4 -vf "select='eq(n\,450)+eq(n\,690)+eq(n\,900)+eq(n\,1200)',scale=640:-1,tile=2x2" -frames:v 1 -vsync vfr /private/tmp/claude-501/-Users-take-Library-Application-Support-Claude-scratch-workspaces-dc8e4108-4634-4b95-a2a9-1bf7926c320c-73410535-eea1-4f2b-a623-15ff1bf45e06-scratch-2026-10-31-ab56d9/909bae78-3207-4843-8849-4984e3aa224d/scratchpad/check.png
echo done
