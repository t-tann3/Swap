export type BuyerStackParamList = {
  Browse: undefined;
  ListingDetail: { id: string };
  Checkout: { listingId: string };
};

export type ListingDraft = {
  title: string;
  description: string;
  category: import("../marketplace/categories").ListingCategory;
  imageUrl: string | null;
  barcode?: string;
};

export type SellStackParamList = {
  SellHome: { draft?: ListingDraft } | undefined;
  Inventory: undefined;
  BarcodeScan: undefined;
  ListingDetail: { id: string };
};

export type FavoritesStackParamList = {
  FavoritesHome: undefined;
  ListingDetail: { id: string };
  Checkout: { listingId: string };
};

export type OrdersStackParamList = {
  OrdersHome: undefined;
  OrderDetail: { orderId: string };
  DropOff: { orderId: string };
  Pickup: { orderId: string };
};

export type RootTabParamList = {
  BrowseTab: undefined;
  FavoritesTab: undefined;
  BasketTab: undefined;
  SellTab: undefined;
  OrdersTab: undefined;
  AdminTab: undefined;
  AccountTab: undefined;
};
