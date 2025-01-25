export interface Rubro {
  id: string;
  nombre: string;
  descripcion: string;
  slug: string;
  icono?: string;
  estado: boolean;
  orden: number;
  createdAt: Date;
  updatedAt: Date;
}