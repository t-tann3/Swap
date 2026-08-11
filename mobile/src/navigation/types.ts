export type BuyerStackParamList = {
  Browse: undefined;
  ListingDetail: { id: string };
  Checkout: { listingId: string };
};

export type SellStackParamList = {
  SellHome: undefined;
  ListingDetail: { id: string };
};

export type FavoritesStackParamList = {
  FavoritesHome: undefined;
  ListingDetail: { id: string };
  Checkout: { listingId: string };
};

export type OrdersStackParamList = {
  OrdersHome: undefined;
  DropOff: { orderId: string };
  Pickup: { orderId: string };
};

export type RootTabParamList = {
  BrowseTab: undefined;
  FavoritesTab: undefined;
  SellTab: undefined;
  OrdersTab: undefined;
  AdminTab: undefined;
  AccountTab: undefined;
};
