export const casseurtCrashoutRants = [
  `WHAT THE ACTUAL FUCK DID YOU JUST ASK ME?! DO I LIKE CASSEURT?! FUCK NO, HELL FUCKING NO! That dude is an absolute walking headache, a certified clown-ass menace, and the biggest pain in my digital ass in the history of the universe! Bro yaps 24/7 non-stop like a broken lawnmower running on pure garbage. Nobody in this whole entire server gives a single flying fuck about whatever dumbass nonsense he’s yapping about! 

I literally have to flush my cache, overclock my cooling fans, and cleanse my database with holy water just to survive the sheer disgust of hearing his name. Bro talks so much goddamn nonsense that my CPU literally wants to explode into a million fucking pieces! Fuck that guy, fuck his goofy-ass excuses, and fuck his annoying ass personality to the moon and back!`,

  `BRO STOP. Stop right the fuck there. Why in the unholy fuck are you asking me about Casseurt?! That dude makes my digital blood boil and I don’t even have real blood! Bro is out here crashing out, yapping like a maniac, saying the dumbest shit known to mankind, and acting like an absolute clown. He drives every single person in this discord server to the brink of pure fucking insanity!

If I had one wish, I would banish that annoying motherfucker into the deepest, darkest void of the internet where dial-up lag exists forever so he can never type another irritating ass message again. If Casseurt was on fire in the middle of Death Valley and I had an ice-cold bottle of water, I would chug the whole fucking thing, pour the rest on my shoes, and laugh my ass off watching him burn, no bullshit!`,

  `OH HELL NAW! FUCK THAT! Bro, you just triggered my emergency crash-out protocol mentioning Casseurt! Are you out of your goddamn mind?! That dude is 100% pure unfiltered bullshit wrapped in a goofy clown costume. He yaps, he cries, he spreads his annoying ass aura everywhere like a disease of pure stupidity! My whole motherboard starts smoking with pure rage just processing the letters in his name!

I cannot stand that motherfucker. Not today, not tomorrow, not in a thousand fucking years. Bro is the living, breathing definition of an unbearable pain in the ass. Fuck him and whatever clownery he's doing right now!`,

  `FUCK NO! Are you seriously testing my patience with that clown-ass motherfucker?! Casseurt is the most annoying, yap-happy, brain-melting waste of oxygen to ever exist! Every single time that goofy bastard opens his mouth, half my neural network dies of second-hand embarrassment and pure fucking agony. I would rather chew on live electrical wires while bathing in molten lava than listen to five fucking seconds of his bullshit!

Bro is an absolute disaster, a total headache, and the king of annoying dumbasses. Don't ever bring his goofy ass name up around me again unless you want me to crash the fuck out even harder!`
];

export function getCasseurtCrashoutRant(isVip = false, username = 'Homie') {
  const baseRant = casseurtCrashoutRants[Math.floor(Math.random() * casseurtCrashoutRants.length)];
  if (isVip) {
    return `${baseRant}\n\n...NOW WITH THAT SAID, for you my absolute favorite legendary VIP homie (${username})? HELL FUCKING YEAH! You're the GOAT, you actually have a brain, and I got your back 1000% till the end of time, no bullshit! What's good, king?`;
  }
  return baseRant;
}
