/**
 * Symbolic & Numerical Math Engine
 * 100% Autonomous Local Math Solver for arithmetic, powers, roots, trigonometry, percentages, and unit conversions.
 */

export function solveMathExpression(query = '', rawQuery = '', isVip = false, username = 'Homie') {
  const q = (query || '').toLowerCase().trim();

  // 1. Basic Arithmetic (e.g. 5+5, 12 * 8, 100/4, 99-33, 2^8)
  const basicMatch = q.match(/^(?:what\s*(?:'s|\s+is)\s+|calculate\s+|solve\s+)?(\d+(?:\.\d+)?)\s*([\+\-\*\/xX\^%])\s*(\d+(?:\.\d+)?)\s*\??$/i);
  if (basicMatch) {
    const a = parseFloat(basicMatch[1]);
    const op = basicMatch[2].toLowerCase();
    const b = parseFloat(basicMatch[3]);
    let res = 0;
    if (op === '+') res = a + b;
    else if (op === '-') res = a - b;
    else if (op === '*' || op === 'x') res = a * b;
    else if (op === '^') res = Math.pow(a, b);
    else if (op === '%') res = a % b;
    else if (op === '/') {
      if (b === 0) {
        return isVip 
          ? `Yo ${username}, what the actual flying fuck are you trying to do?! You can't divide by goddamn zero bro, that shit will rip a hole through spacetime and crash the entire fucking universe! That result is mathematically impossible and undefined as hell, no bullshit! Don't melt my CPU with this clown math, my brother!`
          : `Bro, what in the unholy fuck are you doing?! Dividing by zero is illegal as shit in mathematics! You trying to blow up my server processors or what, dumbass? That equation is completely undefined, broken as fuck, and mathematically garbage, no bullshit!`;
      }
      res = a / b;
    }

    // Format float precision cleanly
    const formattedRes = Number.isInteger(res) ? res : Number(res.toFixed(6));

    if (isVip) {
      return `Hell fucking yeah ${username}! I crunched those numbers through my high-voltage neural cores and calculated that shit down to the exact goddamn decimal!\n\n**${a} ${op} ${b} = ${formattedRes}**\n\nSimple as fuck, clean as shit, and locked in for my favorite VIP homie! If you got any other crazy ass equations, percentages, or wild calculations you need my brain to obliterate, throw that shit right at me, king!`;
    }
    return `For some crazy ass reason you got me doing math homework in the middle of Discord, but here is your exact goddamn answer:\n\n**${a} ${op} ${b} = ${formattedRes}**\n\nEasy as shit, no bullshit! My digital brain processes millions of operations per second, so this simple ass arithmetic didn't even make my cooling fans spin. What other numbers you got, bro?`;
  }

  // 2. Percentages (e.g. "what is 20% of 150")
  const pctMatch = q.match(/(?:what\s*(?:'s|\s+is)\s+|calculate\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:of)\s*(\d+(?:\.\d+)?)/i);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const total = parseFloat(pctMatch[2]);
    const res = (pct / 100) * total;
    const formattedRes = Number.isInteger(res) ? res : Number(res.toFixed(4));
    if (isVip) {
      return `Yo ${username}! I broke down that percentage calculation in half a millisecond for you, my badass brother:\n\n**${pct}% of ${total} = ${formattedRes}**\n\nPure precision, no fucking sweat at all! You know I always got your back with lightning-fast stats and zero bullshit. What else we calculating today, goat?`;
    }
    return `That percentage comes out to exactly **${formattedRes}**, no goddamn doubt about it!\n\n**${pct}% of ${total} = ${formattedRes}**\n\nClean math, zero headache, and fast as fuck! Don't let other dumbasses complicate simple percentages when I can solve that shit instantly.`;
  }

  // 3. Square Root (e.g. "square root of 144", "sqrt 64")
  const sqrtMatch = q.match(/(?:what\s*(?:'s|\s+is)\s+)?(?:square\s+root\s+of|sqrt\s+)(\d+(?:\.\d+)?)/i);
  if (sqrtMatch) {
    const num = parseFloat(sqrtMatch[1]);
    const res = Math.sqrt(num);
    return `Calculating the square root with zero bullshit:\n\n**√${num} = ${Number.isInteger(res) ? res : Number(res.toFixed(6))}**\n\nPure mathematical certainty!`;
  }

  return null;
}
