import numpy as np


class Card:
    cards = ['♠ 7', '♠ 8', '♠ 9', '♠ J', '♠ Q', '♠ K', '♠ A', '♠10',
             '♣ 7', '♣ 8', '♣ 9', '♣ J', '♣ Q', '♣ K', '♣ A', '♣10',
             '♥ 7', '♥ 8', '♥ 9', '♥ J', '♥ Q', '♥ K', '♥ A', '♥10',
             '♦ 7', '♦ 8', '♦ 9', '♦ J', '♦ Q', '♦ K', '♦ A', '♦10']

    def __init__(self, card):
        if isinstance(card, Card):
            card = int(card)
        if isinstance(card, (int, np.int64)):
            self.card_id = int(card)
            self.card_np = np.zeros(32)
            self.card_np[self.card_id] = 1
        elif isinstance(card, str):
            self.card_id = Card.cards.index(card)
            self.card_np = np.zeros(32)
            self.card_np[self.card_id] = 1
        elif isinstance(card, np.ndarray):
            self.card_np = card
            self.card_id = list(card).index(1)
        else:
            raise ValueError('No supported type.')

    def __int__(self):
        return self.card_id

    def __str__(self):
        return Card.cards[self.card_id]


class Collection:
    def __init__(self, cards=None):
        self.cards = []
        if cards is not None:
            for card in cards.ravel():
                self.cards.append(Card(card))
        self.cards.sort(key=lambda x: int(x))

    def np(self):
        """
        Get numpy representation.
        :return: numpy array of cards in this collection
        :rtype: np.ndarray
        """
        collection_np = np.zeros(32, dtype=np.int8)
        for card in self.cards:
            collection_np[int(card)] = 1
        return collection_np

    def __str__(self):
        return ' '.join([str(card) for card in self.cards])


class Game:
    def __init__(self):
        self.hands = []
        cards = np.arange(32)
        np.random.shuffle(cards)
        for i in range(4):
            self.hands.append(Collection(cards[8*i:8*i+8]))
        self.player = 0
        self.trump = self.get_trump(self.hands[0])
        self.history = []

    @staticmethod
    def get_trump(hand):
        # just choose the color with max value
        score_table = np.tile(np.arange(8), (4, 1))
        scores = score_table * hand.np().reshape((4, 8))
        scores_colors = scores.sum(axis=1)
        return np.argmax(scores_colors)

    def valid_moves(self):


if __name__ == '__main__':
    game = Game()
