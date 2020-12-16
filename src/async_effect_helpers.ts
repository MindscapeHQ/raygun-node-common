import { scopedDebug } from "./debug";

const debug = scopedDebug("effect-recorder");

function makeEffectRecorder<Effect>(recordEffect: (effect: Effect) => void) {
  return function (label: string) {
    let aborted = false;

    function effectRecorder(effect: Effect) {
      if (aborted) {
        return;
      }

      recordEffect(effect);
    }

    effectRecorder.abort = () => {
      debug("Aborted", recordEffect.name);
      aborted = true;
    };

    debug("Made", recordEffect.name);
    return effectRecorder;
  };
}

export const recordQueryWithExitPoint = makeEffectRecorder(
  console.log.bind(console, "query")
);
export const recordHTTPRequestWithExitPoint = makeEffectRecorder(
  console.log.bind(console, "request")
);
