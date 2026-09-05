import { BookEditor } from "@/components/book-editor";
import { requireFamily } from "@/lib/family/context";
export default async function BookProjectPage({params}:{params:Promise<{id:string}>}){await requireFamily();return <BookEditor id={(await params).id}/>;}
