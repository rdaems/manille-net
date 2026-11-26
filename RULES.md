# The rules this project plays

West Flemish manillen for four, as described by the Dutch Wikipedia article *Manillen* and by
pagat.com (`/manille/manillen.html`, after Lennert Lanssens). Where the two agree, that is the
rule. Where they differ or leave a choice, the choice made here is marked **choice**: these
are house rules, and Rembert decides them.

## Cards

32 cards, 7 to ace in four suits. Strength in a suit: 10 (the manille), A, H, D, B, 9, 8, 7.
Points: 10 = 5, A = 4, H = 3, D = 2, B = 1, the rest 0. That is 60 in the pack. No points for
tricks.

## The deal

Four players, partners opposite, eight cards each. Play runs clockwise. The dealer looks at
his cards and names trump, or plays without trump, which doubles the deal. Nobody may refuse.
The player left of the dealer leads; the deal passes to the left.

An opponent of the dealer may go along (*meegaan*, *kloppen*): the deal counts double. The
dealer's side may then go against (*tegengaan*): double again.

- **choice**: the opponent left of the dealer is asked first, then the other one; then the
  dealer, then his partner. One meegaan and one tegengaan at most.
- **choice**: the multipliers multiply (no trump 2 × meegaan 2 × tegengaan 2 = 8, pagat's
  reading). Wikipedia caps a deal at × 4 and has no tegengaan without trump.
- Not played: blinde mull, en face (the dealer's partner chooses), eeuwig kloppen, redeals.

## What may be played

1. Follow suit.
2. When an opponent holds the trick with a card of the suit led, go over it if you can. (Also
   when trumps are led: neither source says so in so many words, pagat's wording covers it.)
3. When you cannot follow and an opponent holds the trick: trump. If it has been trumped
   already: overtrump. If you cannot overtrump, throw a plain card.
4. A trump below the trump that holds the trick is never allowed, unless you have nothing else.
5. When your partner holds the trick you are free: you need not go over, need not trump (rule
   4 still holds).

`site/js/manille.js` (`legal`) is these five rules; `test/rules.test.js` has one case for each.

## The score

The side with more than 30 card points scores what it has above 30, times the multiplier of
the deal; the other side scores nothing. All eight tricks: 60 instead of 30. At 30-30 nobody
scores and the next deal counts double (**choice**: pagat's rule; Wikipedia has it as a café
rule). First to 101 wins the game (the *boom*).
