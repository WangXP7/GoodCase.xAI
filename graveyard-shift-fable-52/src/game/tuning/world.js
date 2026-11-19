// The world's gameplay numbers: door prices, boards on windows, the walkway height.
// Read, never copied: purchases read doors[id] for the price, the AI reads
// boards.tearEvery, the interact hold reads boards.repairEvery.
export const world = {
  // price of each door. d1 forecourt-diner, d2 diner kitchen-motel,
  // d3 motel-garage, d4 garage-forecourt (east fence gate), d5 forecourt-motel (service alley)
  doors: { d1: 750, d2: 1000, d3: 1250, d4: 1000, d5: 1500 },
  boards: {
    max: 6,               // boards on a window when the game starts and when a window is fully rebuilt
    tearEvery: 0.9,       // s: a zombie at a window pulls one board off this often
    repairEvery: 0.6,     // s of hold for the player to put one board back
    repairPoints: 10,     // points for each board put back...
    repairCapPerRound: 200, // ...but no more than this many points from boards in one round
  },
  floors: { upper: 3.04, rise: 0.19, tread: 0.30 }, // the motel's upper floor and its stair steps
};
