/**
 * Physical Actions & Everyday How-To Engine
 * 100% Autonomous Local Physics & Physical Manipulation Solver
 * Deconstructs physical tasks into precise kinesthetic, spatial, and mechanical steps.
 */

export function solvePhysicalAction(query = '', rawQuery = '', isVip = false, username = 'Homie') {
  const q = (query || '').toLowerCase().trim();

  // ── 1. Apple from a bowl (Direct match & generalized fruit/object from container)
  if ((q.includes('remove') || q.includes('take') || q.includes('get') || q.includes('lift') || q.includes('retirer') || q.includes('enlever')) &&
      (q.includes('apple') || q.includes('pomme') || q.includes('fruit') || q.includes('item') || q.includes('object')) &&
      (q.includes('bowl') || q.includes('bol') || q.includes('basket') || q.includes('panier') || q.includes('container'))) {
    
    const targetItem = q.includes('apple') ? 'the apple' : (q.includes('pomme') ? 'la pomme' : 'the object');
    const container = q.includes('bowl') ? 'the bowl' : (q.includes('bol') ? 'le bol' : 'the container');

    return `Hell fucking yeah bro, let's keep it 100% real and practical:\n\n` +
      `To remove **${targetItem}** from **${container}**, follow these exact physical steps:\n\n` +
      `1. **Approach & Locate**: Look directly into ${container} and pinpoint the position and orientation of ${targetItem}.\n` +
      `2. **Reach & Position**: Extend your dominant hand toward ${container} and open your fingers wide enough to encompass the curvature of ${targetItem}.\n` +
      `3. **Grip Firmly**: Place your thumb and fingertips around ${targetItem}. Apply gentle, steady grip pressure so it doesn't slip from your fingers.\n` +
      `4. **Lift Upward (Clearance)**: Pull your hand vertically upward until the bottom of ${targetItem} clears the top edge or rim of ${container}.\n` +
      `5. **Relocate or Set Down**: Move ${targetItem} away from ${container} and place it on a clean plate, tabletop, or hold it to eat/use.\n\n` +
      `Clean, fast, and simple as fuck!`;
  }

  // ── 2. Pouring liquid (e.g. water into a glass, milk into a cup)
  if ((q.includes('pour') || q.includes('fill') || q.includes('verser')) && 
      (q.includes('water') || q.includes('liquid') || q.includes('drink') || q.includes('glass') || q.includes('cup') || q.includes('bottle') || q.includes('eau') || q.includes('verre'))) {
    return `Pouring liquid without making a goddamn mess is all about gravity, angle control, and flow rate, no fucking bullshit!\n\n` +
      `1. **Stabilize the Vessel**: Place the empty glass or cup on a flat, level surface with stable footing.\n` +
      `2. **Grip the Container**: Grasp the pitcher or bottle firmly around the body or handle with your primary hand.\n` +
      `3. **Position Over Target**: Hover the spout or opening 2 to 3 inches directly above the center of the recipient glass.\n` +
      `4. **Controlled Tilt**: Slowly tilt the container until the liquid reaches the lip and begins a smooth laminar stream.\n` +
      `5. **Monitor & Counter-Tilt**: When the glass reaches roughly 80% capacity, rotate the pitcher back upright in a swift motion to prevent drips.\n\n` +
      `Zero spills, zero wasted drinks, and smooth as hell!`;
  }

  // ── 3. Opening a door / turn doorknob
  if ((q.includes('open') || q.includes('ouvrir')) && (q.includes('door') || q.includes('porte') || q.includes('knob') || q.includes('handle') || q.includes('poignée'))) {
    return `Opening a physical door requires mechanical torque and kinetic vector clearance, no fucking bullshit!\n\n` +
      `1. **Approach & Clearance**: Stand within arm's reach of the door without standing directly in its path of swing.\n` +
      `2. **Contact & Grip**: Place your palm and fingers securely over the doorknob or handle lever.\n` +
      `3. **Rotate Latch**: Turn the knob clockwise (or push the lever downward) until the internal spring-loaded latch retracts from the strike plate.\n` +
      `4. **Push or Pull**: While holding the latch retracted, apply forward push pressure (if push-door) or pull backward (if pull-door) until the door swings clear of the frame.\n` +
      `5. **Pass Through**: Step through the threshold and release the handle smoothly so it re-engages without slamming.\n\n` +
      `Simple physical mechanics executed like a champion!`;
  }

  // ── 4. Tying shoelaces
  if ((q.includes('tie') || q.includes('lacer') || q.includes('attacher')) && (q.includes('shoe') || q.includes('lace') || q.includes('sneaker') || q.includes('chaussure') || q.includes('lacet'))) {
    return `Tying shoelaces with maximum knot tension and zero slippage, no fucking bullshit!\n\n` +
      `1. **The Base Knot**: Take both lace ends, cross them over one another to form an X, tuck one lace under, and pull both ends tight against the shoe tongue.\n` +
      `2. **Form the First Loop**: Fold one lace in half to create a small "bunny ear" loop held between thumb and index finger.\n` +
      `3. **Wrap the Second Lace**: Take the remaining lace and wrap it completely around the base of the first loop.\n` +
      `4. **Push Through**: Push the middle of the second lace through the hole created at the base to form a second loop.\n` +
      `5. **Lock & Double Knot**: Grab both loops and pull outward with equal tension. Cross both loops once more and tighten for an indestructible double knot!\n\n` +
      `Locked down tight and ready to run all day!`;
  }

  // ── 5. Generalized Physical Action Parser for "how to [verb] [object]"
  const physicalActionMatch = q.match(/^(?:how\s+(?:to|do\s+i|can\s+i)\s+)?(pick\s+up|grab|lift|carry|move|open|close|slice|cut|clean|wash|plug\s+in|unplug|fold|press|push|pull)\s+(?:the\s+|an?\s+)?([a-z0-9\s]+?)(?:\s+(?:from|into|on|to|with|using)\s+([a-z0-9\s]+))?[\s.!?]*$/i);

  if (physicalActionMatch) {
    const verb = physicalActionMatch[1].trim();
    const target = physicalActionMatch[2].trim();
    const secondary = physicalActionMatch[3] ? physicalActionMatch[3].trim() : '';

    return `Hell fucking yeah bro, here is the exact physical step-by-step breakdown to **${verb} ${target}**${secondary ? ` (${secondary})` : ''}:\n\n` +
      `1. **Spatial Assessment**: Inspect the geometry, weight distribution, and surroundings of the ${target} to ensure a clear pathway.\n` +
      `2. **Kinetic Alignment**: Position your body and hands at the optimal biomechanical angle to maintain leverage and control.\n` +
      `3. **Secure Engagement**: Apply intentional contact, establishing full surface grip before initiating kinetic force.\n` +
      `4. **Controlled Execution**: Perform the ${verb} motion steadily, maintaining balance and checking clearance at each phase.\n` +
      `5. **Stable Completion**: Settle the ${target} into its final resting state or verify the desired mechanical outcome is locked in.\n\n` +
      `Precision physics, zero accidents, and clean execution!`;
  }

  return null;
}
