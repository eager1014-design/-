// Remotion 에 "Episode" 영상을 등록한다. 길이·크기는 대본(episode.json)을 보고 정한다.
// 렌더링: npx remotion render Episode out/영상.mp4 --props=public/episodes/<편>/episode.json
import React from "react";
import { Composition, Still } from "remotion";
import { Episode } from "./Episode.jsx";
import { Thumbnail } from "./Thumbnail.jsx";
import { FPS, SIZES } from "./theme.js";
import { applyPace, totalFrames } from "./timing.js";
import sample from "./sample-episode.json";

// 썸네일: npx remotion still Thumbnail out/<편>_thumb.png --props=public/episodes/<편>/upload.json
const THUMB = { long: { width: 1280, height: 720 }, short: { width: 1080, height: 1920 } };

export function RemotionRoot() {
  return (
    <>
    <Still
      id="Thumbnail"
      component={Thumbnail}
      {...THUMB.long}
      defaultProps={{ thumbnail: { lines: ["썸네일 **예시**"] } }}
      calculateMetadata={({ props }) => THUMB[props.thumbnail?.format] || THUMB.long}
    />
    <Composition
      id="Episode"
      component={Episode}
      fps={FPS}
      width={SIZES.long.width}
      height={SIZES.long.height}
      durationInFrames={totalFrames(sample.scenes)}
      defaultProps={sample}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, totalFrames(applyPace(props.scenes || [], props.pace))),
        ...(SIZES[props.format] || SIZES.long),
      })}
    />
    </>
  );
}
