#!/bin/sh
# Original 8-bit style blips, generated with ffmpeg lavfi aevalsrc (square/sine waves + exp envelopes). No third-party material.
# square(x) := 2*gt(sin(x),0)-1   (ffmpeg's expression evaluator has no sign())
set -e
# 1. throw sweep: square chirp 220->880 Hz over 0.18s, fast exp decay  (ball throw / whoosh-boing)
ffmpeg -y -v error -f lavfi -i "aevalsrc='0.5*(2*gt(sin(2*PI*(220*t+(880-220)*t*t/(2*0.18))),0)-1)*exp(-8*t)':s=44100:d=0.22" -af "afade=t=out:st=0.17:d=0.05" -ar 44100 -ac 1 blip_throw_sweep_up.wav
# 2. catch pop: two-step square 1046 Hz then 1568 Hz, 60 ms each, quick decay  (catch / happy pop)
ffmpeg -y -v error -f lavfi -i "aevalsrc='0.45*(2*gt(sin(2*PI*if(lt(t,0.06),1046,1568)*t),0)-1)*exp(-12*t)':s=44100:d=0.16" -ar 44100 -ac 1 blip_catch_pop.wav
# 3. feed chime: sine + 3rd harmonic, 659->784->988 Hz arpeggio in 70 ms steps, gentle decay  (feed / soft chime)
ffmpeg -y -v error -f lavfi -i "aevalsrc='0.4*(sin(2*PI*if(lt(t,0.07),659,if(lt(t,0.14),784,988))*t)+0.2*sin(6*PI*if(lt(t,0.07),659,if(lt(t,0.14),784,988))*t))*exp(-5*t)':s=44100:d=0.35" -af "afade=t=out:st=0.28:d=0.07" -ar 44100 -ac 1 blip_feed_chime.wav
