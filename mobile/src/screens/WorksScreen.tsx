import { useNavigation } from "@react-navigation/native";
import type { AppNavigation } from "../navigation/types";
import { BooksScreen } from "./BookScreens";
export function WorksScreen() {
  const navigation = useNavigation<AppNavigation>();
  return <BooksScreen navigation={navigation} />;
}
